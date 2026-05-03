-- Upgrade quantity fields to decimal(18,4) for decimal quantity support
ALTER TABLE "TransactionItem"
  ALTER COLUMN "quantity" TYPE DECIMAL(18,4) USING "quantity"::DECIMAL(18,4);

ALTER TABLE "InboundLine"
  ALTER COLUMN "quantity" TYPE DECIMAL(18,4) USING "quantity"::DECIMAL(18,4);

ALTER TABLE "StockAdjustment"
  ALTER COLUMN "change_qty" TYPE DECIMAL(18,4) USING "change_qty"::DECIMAL(18,4),
  ALTER COLUMN "before_qty" TYPE DECIMAL(18,4) USING "before_qty"::DECIMAL(18,4),
  ALTER COLUMN "after_qty" TYPE DECIMAL(18,4) USING "after_qty"::DECIMAL(18,4);
