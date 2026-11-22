-- AlterTable
ALTER TABLE "risk_scores" ADD COLUMN     "rules_version" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "spring_endpoints" ADD COLUMN     "security" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "vulnerabilities" ADD COLUMN     "evidence_references" JSONB;

-- CreateIndex
CREATE INDEX "risk_scores_project_vulnerability_id_idx" ON "risk_scores"("project_vulnerability_id");
