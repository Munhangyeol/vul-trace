-- AlterTable
ALTER TABLE "project_vulnerabilities" ADD COLUMN     "reachability_analysis" JSONB,
ADD COLUMN     "reachability_status" TEXT;

-- AlterTable
ALTER TABLE "reachability_paths" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sink_attribution" TEXT NOT NULL DEFAULT 'METHOD',
ADD COLUMN     "usage" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "reachability_paths_project_vulnerability_id_idx" ON "reachability_paths"("project_vulnerability_id");
