-- CreateTable
CREATE TABLE "InboundBreakdown" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "material_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "processing_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "material_note" TEXT,
    "processing_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundBreakdown_transaction_id_key" ON "InboundBreakdown"("transaction_id");

-- AddForeignKey
ALTER TABLE "InboundBreakdown" ADD CONSTRAINT "InboundBreakdown_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
