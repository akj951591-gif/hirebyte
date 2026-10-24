-- Part D: phones can rejoin after a reload (device token), and consent records which feeds were recorded.

-- AlterTable
ALTER TABLE "ConsentRecord" ADD COLUMN     "recordedFeeds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "MediaSession" ADD COLUMN     "phoneDeviceTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MediaSession_phoneDeviceTokenHash_key" ON "MediaSession"("phoneDeviceTokenHash");
