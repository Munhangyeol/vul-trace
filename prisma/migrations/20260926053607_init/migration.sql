-- CreateEnum
CREATE TYPE "ScanState" AS ENUM ('PENDING', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "state" "ScanState" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "stage_results" JSONB NOT NULL DEFAULT '[]',
    "unresolved_dependencies" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependencies" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "purl" TEXT NOT NULL,

    CONSTRAINT "dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_dependencies" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "dependency_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "direct" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "source_path" TEXT,
    "introduced_by" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "project_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vulnerabilities" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "aliases" TEXT[],
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "cvss_vector" TEXT,
    "references" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "vulnerabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_vulnerabilities" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "project_dependency_id" TEXT NOT NULL,
    "vulnerability_id" TEXT NOT NULL,
    "fixed_versions" TEXT[],

    CONSTRAINT "project_vulnerabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_usages" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "project_vulnerability_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "snippet" TEXT NOT NULL,
    "usage_kind" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,

    CONSTRAINT "source_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spring_endpoints" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "http_method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "controller_class" TEXT NOT NULL,
    "controller_method" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "line" INTEGER NOT NULL,

    CONSTRAINT "spring_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methods" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "class_name" TEXT NOT NULL,
    "method_name" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "line" INTEGER NOT NULL,

    CONSTRAINT "methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "method_calls" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "caller_method_id" TEXT NOT NULL,
    "callee_method_id" TEXT NOT NULL,
    "line" INTEGER NOT NULL,

    CONSTRAINT "method_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reachability_paths" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "project_vulnerability_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "steps" JSONB NOT NULL,

    CONSTRAINT "reachability_paths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_scores" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "project_vulnerability_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" JSONB NOT NULL,

    CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_jobs_project_id_idx" ON "scan_jobs"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "dependencies_purl_key" ON "dependencies"("purl");

-- CreateIndex
CREATE UNIQUE INDEX "project_dependencies_scan_id_dependency_id_key" ON "project_dependencies"("scan_id", "dependency_id");

-- CreateIndex
CREATE UNIQUE INDEX "vulnerabilities_source_id_key" ON "vulnerabilities"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_vulnerabilities_project_dependency_id_vulnerability_key" ON "project_vulnerabilities"("project_dependency_id", "vulnerability_id");

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_dependency_id_fkey" FOREIGN KEY ("dependency_id") REFERENCES "dependencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_vulnerabilities" ADD CONSTRAINT "project_vulnerabilities_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_vulnerabilities" ADD CONSTRAINT "project_vulnerabilities_project_dependency_id_fkey" FOREIGN KEY ("project_dependency_id") REFERENCES "project_dependencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_vulnerabilities" ADD CONSTRAINT "project_vulnerabilities_vulnerability_id_fkey" FOREIGN KEY ("vulnerability_id") REFERENCES "vulnerabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_usages" ADD CONSTRAINT "source_usages_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_usages" ADD CONSTRAINT "source_usages_project_vulnerability_id_fkey" FOREIGN KEY ("project_vulnerability_id") REFERENCES "project_vulnerabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spring_endpoints" ADD CONSTRAINT "spring_endpoints_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methods" ADD CONSTRAINT "methods_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "method_calls" ADD CONSTRAINT "method_calls_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "method_calls" ADD CONSTRAINT "method_calls_caller_method_id_fkey" FOREIGN KEY ("caller_method_id") REFERENCES "methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "method_calls" ADD CONSTRAINT "method_calls_callee_method_id_fkey" FOREIGN KEY ("callee_method_id") REFERENCES "methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reachability_paths" ADD CONSTRAINT "reachability_paths_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reachability_paths" ADD CONSTRAINT "reachability_paths_project_vulnerability_id_fkey" FOREIGN KEY ("project_vulnerability_id") REFERENCES "project_vulnerabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reachability_paths" ADD CONSTRAINT "reachability_paths_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "spring_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_scores" ADD CONSTRAINT "risk_scores_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_scores" ADD CONSTRAINT "risk_scores_project_vulnerability_id_fkey" FOREIGN KEY ("project_vulnerability_id") REFERENCES "project_vulnerabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
