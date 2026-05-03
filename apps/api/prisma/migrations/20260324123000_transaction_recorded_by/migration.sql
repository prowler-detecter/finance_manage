ALTER TABLE "Transaction"
ADD COLUMN "recorded_by_id" INTEGER;

CREATE INDEX "Transaction_recorded_by_id_idx" ON "Transaction"("recorded_by_id");

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_recorded_by_id_fkey"
FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
