-- CreateEnum
CREATE TYPE "InboundLineType" AS ENUM ('material', 'processing');

-- CreateTable
CREATE TABLE "InboundLine" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "line_type" "InboundLineType" NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "spec" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "line_amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundLine_transaction_id_idx" ON "InboundLine"("transaction_id");

-- CreateIndex
CREATE INDEX "InboundLine_line_type_idx" ON "InboundLine"("line_type");

-- AddForeignKey
ALTER TABLE "InboundLine" ADD CONSTRAINT "InboundLine_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
