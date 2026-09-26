import type { HttpMethod } from '@vulntrace/shared';

export const CONTROLLER_ANNOTATIONS = ['RestController', 'Controller'] as const;

/** `null` means the HTTP method comes from the `method` attribute (@RequestMapping). */
export const MAPPING_ANNOTATIONS: Readonly<Record<string, HttpMethod | null>> = {
  RequestMapping: null,
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};
