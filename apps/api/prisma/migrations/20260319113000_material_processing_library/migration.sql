-- CreateTable
CREATE TABLE "Processing" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "spec" TEXT,
    "unit" TEXT NOT NULL,
    "default_unit_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Processing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Processing_code_key" ON "Processing"("code");

-- CreateIndex
CREATE INDEX "Processing_active_idx" ON "Processing"("active");

-- AlterTable
ALTER TABLE "Material" ADD COLUMN "default_unit_price" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InboundLine" ADD COLUMN "processing_id" INTEGER;

-- CreateIndex
CREATE INDEX "InboundLine_processing_id_idx" ON "InboundLine"("processing_id");

-- AddForeignKey
ALTER TABLE "InboundLine"
ADD CONSTRAINT "InboundLine_processing_id_fkey"
FOREIGN KEY ("processing_id") REFERENCES "Processing"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill material default unit price from latest mapped material lines.
WITH latest_material_price AS (
  SELECT DISTINCT ON (il.material_id)
    il.material_id,
    il.unit_price
  FROM "InboundLine" il
  JOIN "Transaction" t ON t.id = il.transaction_id
  WHERE il.line_type = 'material'::"InboundLineType"
    AND il.material_id IS NOT NULL
    AND t.type IN ('in', 'purchase_return')
  ORDER BY il.material_id, t.transaction_date DESC, t.recorded_at DESC, il.id DESC
)
UPDATE "Material" m
SET default_unit_price = latest_material_price.unit_price
FROM latest_material_price
WHERE m.id = latest_material_price.material_id
  AND COALESCE(m.default_unit_price, 0) = 0;

-- Backfill processing master + inbound line mapping for historical inbound/purchase_return processing lines.
DO $$
DECLARE
  row_record RECORD;
  found_processing_id INTEGER;
  normalized_code TEXT;
  normalized_spec TEXT;
BEGIN
  FOR row_record IN
    SELECT
      il.id AS line_id,
      il.name AS line_name,
      il.sku AS line_sku,
      il.spec AS line_spec,
      il.unit AS line_unit,
      il.unit_price AS line_unit_price
    FROM "InboundLine" il
    JOIN "Transaction" t ON t.id = il.transaction_id
    WHERE il.line_type = 'processing'::"InboundLineType"
      AND t.type IN ('in', 'purchase_return')
    ORDER BY il.id
  LOOP
    normalized_code := NULLIF(BTRIM(COALESCE(row_record.line_sku, '')), '');
    normalized_spec := NULLIF(BTRIM(COALESCE(row_record.line_spec, '')), '');
    found_processing_id := NULL;

    IF normalized_code IS NOT NULL THEN
      SELECT id INTO found_processing_id
      FROM "Processing"
      WHERE code = normalized_code
      LIMIT 1;

      IF found_processing_id IS NULL THEN
        INSERT INTO "Processing" ("name", "code", "spec", "unit", "default_unit_price", "active", "created_at", "updated_at")
        VALUES (row_record.line_name, normalized_code, normalized_spec, row_record.line_unit, row_record.line_unit_price, TRUE, NOW(), NOW())
        RETURNING id INTO found_processing_id;
      ELSE
        UPDATE "Processing"
        SET
          name = row_record.line_name,
          spec = normalized_spec,
          unit = row_record.line_unit,
          active = TRUE,
          default_unit_price = CASE
            WHEN COALESCE(default_unit_price, 0) = 0 THEN row_record.line_unit_price
            ELSE default_unit_price
          END,
          updated_at = NOW()
        WHERE id = found_processing_id;
      END IF;
    ELSE
      SELECT id INTO found_processing_id
      FROM "Processing"
      WHERE code IS NULL
        AND name = row_record.line_name
        AND COALESCE(spec, '') = COALESCE(normalized_spec, '')
        AND unit = row_record.line_unit
      LIMIT 1;

      IF found_processing_id IS NULL THEN
        INSERT INTO "Processing" ("name", "code", "spec", "unit", "default_unit_price", "active", "created_at", "updated_at")
        VALUES (row_record.line_name, NULL, normalized_spec, row_record.line_unit, row_record.line_unit_price, TRUE, NOW(), NOW())
        RETURNING id INTO found_processing_id;
      ELSE
        UPDATE "Processing"
        SET
          active = TRUE,
          default_unit_price = CASE
            WHEN COALESCE(default_unit_price, 0) = 0 THEN row_record.line_unit_price
            ELSE default_unit_price
          END,
          updated_at = NOW()
        WHERE id = found_processing_id;
      END IF;
    END IF;

    UPDATE "InboundLine"
    SET processing_id = found_processing_id
    WHERE id = row_record.line_id;
  END LOOP;
END $$;

-- Backfill missing material mapping and fill default unit price when absent.
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
      il.unit AS line_unit,
      il.unit_price AS line_unit_price
    FROM "InboundLine" il
    JOIN "Transaction" t ON t.id = il.transaction_id
    WHERE il.line_type = 'material'::"InboundLineType"
      AND t.type IN ('in', 'purchase_return')
      AND il.material_id IS NULL
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
        INSERT INTO "Material" ("name", "code", "spec", "unit", "default_unit_price", "active", "created_at", "updated_at")
        VALUES (row_record.line_name, normalized_code, normalized_spec, row_record.line_unit, row_record.line_unit_price, TRUE, NOW(), NOW())
        RETURNING id INTO found_material_id;
      ELSE
        UPDATE "Material"
        SET
          name = row_record.line_name,
          spec = normalized_spec,
          unit = row_record.line_unit,
          active = TRUE,
          default_unit_price = CASE
            WHEN COALESCE(default_unit_price, 0) = 0 THEN row_record.line_unit_price
            ELSE default_unit_price
          END,
          updated_at = NOW()
        WHERE id = found_material_id;
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
        INSERT INTO "Material" ("name", "code", "spec", "unit", "default_unit_price", "active", "created_at", "updated_at")
        VALUES (row_record.line_name, NULL, normalized_spec, row_record.line_unit, row_record.line_unit_price, TRUE, NOW(), NOW())
        RETURNING id INTO found_material_id;
      ELSE
        UPDATE "Material"
        SET
          active = TRUE,
          default_unit_price = CASE
            WHEN COALESCE(default_unit_price, 0) = 0 THEN row_record.line_unit_price
            ELSE default_unit_price
          END,
          updated_at = NOW()
        WHERE id = found_material_id;
      END IF;
    END IF;

    UPDATE "InboundLine"
    SET material_id = found_material_id
    WHERE id = row_record.line_id;
  END LOOP;
END $$;
