export interface RawPomDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope: string;
  type?: string;
  classifier?: string;
  optional: boolean;
}

export interface RawPomParent {
  groupId: string;
  artifactId: string;
  version: string;
  relativePath?: string;
}

export interface RawPom {
  groupId?: string;
  artifactId: string;
  version?: string;
  packaging: string;
  parent?: RawPomParent;
  properties: Record<string, string>;
  dependencies: RawPomDependency[];
  dependencyManagement: RawPomDependency[];
  modules: string[];
}
