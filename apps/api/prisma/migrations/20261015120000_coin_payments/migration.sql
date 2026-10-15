-- CreateEnum
CREATE TYPE "CoinEventKind" AS ENUM ('INSERTED', 'DISPENSED');

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'COIN';

-- AlterTable
ALTER TABLE "Kiosk" ADD COLUMN     "paymentExpiresAt" TIMESTAMP(3),
ADD COLUMN     "paymentJobId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "changeDispensedMillimes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "changeDueMillimes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "receivedMillimes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CoinEvent" (
    "id" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,
    "paymentId" TEXT,
    "kind" "CoinEventKind" NOT NULL,
    "valueMillimes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoinEvent_kioskId_createdAt_idx" ON "CoinEvent"("kioskId", "createdAt");

-- CreateIndex
CREATE INDEX "CoinEvent_paymentId_idx" ON "CoinEvent"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_paymentJobId_key" ON "Kiosk"("paymentJobId");

-- AddForeignKey
ALTER TABLE "CoinEvent" ADD CONSTRAINT "CoinEvent_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinEvent" ADD CONSTRAINT "CoinEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

