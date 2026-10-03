export interface ProjectDependencyDto {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  direct: boolean;
  purl: string;
  source: {
    kind: 'pom.xml' | 'dependency-tree';
    filePath: string;
    introducedBy?: string[];
  };
}
