-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "JobFile" ADD COLUMN     "conversionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "conversionStartedAt" TIMESTAMP(3),
ADD COLUMN     "conversionStatus" "ConversionStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "JobFile_conversionStatus_createdAt_idx" ON "JobFile"("conversionStatus", "createdAt");
