-- CreateEnum
CREATE TYPE "ProjectSourceType" AS ENUM ('LOCAL', 'GIT');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "ref" TEXT,
ADD COLUMN     "repo_url" TEXT,
ADD COLUMN     "source_type" "ProjectSourceType" NOT NULL DEFAULT 'LOCAL',
ALTER COLUMN "path" DROP NOT NULL;

-- AlterTable
ALTER TABLE "scan_jobs" ADD COLUMN     "commit_sha" TEXT;

