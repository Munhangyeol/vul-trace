/** Minimal CycloneDX 1.5 JSON representation used internally. */
export interface CycloneDxComponent {
  type: 'library';
  group: string;
  name: string;
  version: string;
  purl: string;
  scope?: 'required' | 'optional' | 'excluded';
}

export interface CycloneDxBom {
  bomFormat: 'CycloneDX';
  specVersion: '1.5';
  version: number;
  components: CycloneDxComponent[];
}
