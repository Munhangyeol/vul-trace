import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ProjectDto,
  ProjectListItemDto,
  ProjectSummaryDto,
  ProjectVulnerabilitiesDto,
  ScanJobDto,
  VulnerabilityFindingDto,
} from '@vulntrace/shared';
import { apiGet, apiPost } from './client';

export const queryKeys = {
  projects: ['projects'] as const,
  projectSummary: (projectId: string) => ['projects', projectId, 'summary'] as const,
  vulnerabilities: (projectId: string) => ['projects', projectId, 'vulnerabilities'] as const,
  finding: (findingId: string) => ['findings', findingId] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => apiGet<ProjectListItemDto[]>('/projects'),
  });
}

export function useProjectSummary(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectSummary(projectId),
    queryFn: () => apiGet<ProjectSummaryDto>(`/projects/${projectId}/summary`),
    enabled: projectId.length > 0,
  });
}

export function useVulnerabilities(projectId: string) {
  return useQuery({
    queryKey: queryKeys.vulnerabilities(projectId),
    queryFn: () => apiGet<ProjectVulnerabilitiesDto>(`/projects/${projectId}/vulnerabilities`),
    enabled: projectId.length > 0,
  });
}

export function useFinding(findingId: string) {
  return useQuery({
    queryKey: queryKeys.finding(findingId),
    queryFn: () => apiGet<VulnerabilityFindingDto>(`/findings/${findingId}`),
    enabled: findingId.length > 0,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; path: string }) => apiPost<ProjectDto>('/projects', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

export interface RunScanInput {
  allowMaven?: boolean;
  checkVulnerabilities?: boolean;
}

export function useRunScan(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RunScanInput) =>
      apiPost<ScanJobDto>(`/projects/${projectId}/scans`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSummary(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vulnerabilities(projectId) });
    },
  });
}
