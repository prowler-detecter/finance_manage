-- CreateTable
CREATE TABLE "Material" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "spec" TEXT,
    "unit" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE INDEX "Material_active_idx" ON "Material"("active");

-- AlterTable
ALTER TABLE "InboundLine" ADD COLUMN "material_id" INTEGER;

-- CreateIndex
CREATE INDEX "InboundLine_material_id_idx" ON "InboundLine"("material_id");

-- CreateTable
CREATE TABLE "MaterialStockAdjustment" (
    "id" SERIAL NOT NULL,
    "material_id" INTEGER NOT NULL,
    "mode" "StockAdjustMode" NOT NULL,
    "change_qty" INTEGER NOT NULL,
    "before_qty" INTEGER NOT NULL,
    "after_qty" INTEGER NOT NULL,
    "biz_date" TIMESTAMP(3) NOT NULL,
    "remark" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "operator" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialStockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialStockAdjustment_material_id_biz_date_recorded_at_id_idx" ON "MaterialStockAdjustment"("material_id", "biz_date", "recorded_at", "id");

-- AddForeignKey
ALTER TABLE "InboundLine" ADD CONSTRAINT "InboundLine_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialStockAdjustment" ADD CONSTRAINT "MaterialStockAdjustment_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill material master + line mapping from historical inbound/purchase_return material lines.
DO $$
DECLARE
  row_record RECORD;
  found_material_id INTEGER;
  normalized_code TEXT;
  normalized_spec TEXT;
BEGIN
  FOR row_record IN
    SELECT
      il.id AS line_id,
      il.name AS line_name,
      il.sku AS line_sku,
      il.spec AS line_spec,
      il.unit AS line_unit
    FROM "InboundLine" il
    JOIN "Transaction" t ON t.id = il.transaction_id
    WHERE il.line_type = 'material'::"InboundLineType"
      AND t.type IN ('in', 'purchase_return')
    ORDER BY il.id
  LOOP
    normalized_code := NULLIF(BTRIM(COALESCE(row_record.line_sku, '')), '');
    normalized_spec := NULLIF(BTRIM(COALESCE(row_record.line_spec, '')), '');
    found_material_id := NULL;

    IF normalized_code IS NOT NULL THEN
      SELECT id INTO found_material_id
      FROM "Material"
      WHERE code = normalized_code
      LIMIT 1;

      IF found_material_id IS NULL THEN
        INSERT INTO "Material" ("name", "code", "spec", "unit", "active", "created_at", "updated_at")
        VALUES (row_record.line_name, normalized_code, normalized_spec, row_record.line_unit, TRUE, NOW(), NOW())
        RETURNING id INTO found_material_id;
      END IF;
    ELSE
      SELECT id INTO found_material_id
      FROM "Material"
      WHERE code IS NULL
        AND name = row_record.line_name
        AND COALESCE(spec, '') = COALESCE(normalized_spec, '')
        AND unit = row_record.line_unit
      LIMIT 1;

      IF found_material_id IS NULL THEN
        INSERT INTO "Material" ("name", "code", "spec", "unit", "active", "created_at", "updated_at")
        VALUES (row_record.line_name, NULL, normalized_spec, row_record.line_unit, TRUE, NOW(), NOW())
        RETURNING id INTO found_material_id;
      END IF;
    END IF;

    UPDATE "InboundLine"
    SET material_id = found_material_id
    WHERE id = row_record.line_id;
  END LOOP;
END $$;

-- Clear legacy purchase_return product-detail rows to unify new procurement-return data path.
DELETE FROM "TransactionItem" ti
USING "Transaction" t
WHERE ti.transaction_id = t.id
  AND t.type = 'purchase_return';
