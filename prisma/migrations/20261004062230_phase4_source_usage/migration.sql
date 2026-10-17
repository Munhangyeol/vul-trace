-- AlterTable
ALTER TABLE "project_vulnerabilities" ADD COLUMN     "usage_analysis" JSONB,
ADD COLUMN     "used" BOOLEAN,
ADD COLUMN     "vulnerable_api_status" TEXT;

-- AlterTable
ALTER TABLE "source_usages" ADD COLUMN     "column" INTEGER,
ADD COLUMN     "source_set" TEXT NOT NULL DEFAULT 'MAIN',
ADD COLUMN     "vulnerable_api" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "source_usages_project_vulnerability_id_idx" ON "source_usages"("project_vulnerability_id");
