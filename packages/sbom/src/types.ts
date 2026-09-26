/** Minimal CycloneDX 1.5 JSON representation used internally. */
export interface CycloneDxComponent {
  type: 'library';
  /** Also used as the component's `bom-ref`. */
  purl: string;
  group: string;
  name: string;
  version: string;
  scope?: 'required' | 'optional' | 'excluded';
}

export interface CycloneDxMetadataComponent {
  type: 'application';
  name: string;
  version: string;
}

export interface CycloneDxTool {
  vendor: string;
  name: string;
  version: string;
}

export interface CycloneDxMetadata {
  timestamp: string;
  tools: CycloneDxTool[];
  component: CycloneDxMetadataComponent;
}

/** `ref` depends on each purl in `dependsOn` (CycloneDX `dependencies[]` graph). */
export interface CycloneDxDependencyEdge {
  ref: string;
  dependsOn?: string[];
}

export interface CycloneDxBom {
  bomFormat: 'CycloneDX';
  specVersion: '1.5';
  serialNumber: string;
  version: number;
  metadata: CycloneDxMetadata;
  components: CycloneDxComponent[];
  dependencies: CycloneDxDependencyEdge[];
}
