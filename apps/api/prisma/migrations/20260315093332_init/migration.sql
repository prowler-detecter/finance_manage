-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('customer', 'supplier');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('out', 'in', 'sale_return', 'purchase_return', 'receive', 'pay');

-- CreateEnum
CREATE TYPE "StockAdjustMode" AS ENUM ('set', 'delta');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "profile_remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "spec" TEXT,
    "unit" TEXT NOT NULL,
    "default_unit_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "bookkeeping_date" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "computed_amount" DECIMAL(18,2),
    "remark" TEXT,
    "source_transaction_id" INTEGER,
    "source_ref" TEXT,
    "slip_book" TEXT,
    "slip_no" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionItem" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "line_amount" DECIMAL(18,2) NOT NULL,
    "snapshot_name" TEXT NOT NULL,
    "snapshot_sku" TEXT,
    "snapshot_spec" TEXT,
    "snapshot_unit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
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

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Product_active_idx" ON "Product"("active");

-- CreateIndex
CREATE INDEX "Transaction_partner_id_idx" ON "Transaction"("partner_id");

-- CreateIndex
CREATE INDEX "Transaction_type_slip_book_slip_no_idx" ON "Transaction"("type", "slip_book", "slip_no");

-- CreateIndex
CREATE INDEX "Transaction_transaction_date_recorded_at_id_idx" ON "Transaction"("transaction_date", "recorded_at", "id");

-- CreateIndex
CREATE INDEX "TransactionItem_transaction_id_idx" ON "TransactionItem"("transaction_id");

-- CreateIndex
CREATE INDEX "TransactionItem_product_id_idx" ON "TransactionItem"("product_id");

-- CreateIndex
CREATE INDEX "StockAdjustment_product_id_biz_date_recorded_at_id_idx" ON "StockAdjustment"("product_id", "biz_date", "recorded_at", "id");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
