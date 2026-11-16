-- AlterTable
ALTER TABLE "spring_endpoints" ADD COLUMN     "column" INTEGER,
ADD COLUMN     "evidence" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "unresolved" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "spring_endpoints_scan_id_idx" ON "spring_endpoints"("scan_id");
