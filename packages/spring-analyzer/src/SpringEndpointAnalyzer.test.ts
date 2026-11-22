import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SourceSet } from '@vulntrace/shared';
import { LightweightJavaParser, LightweightJavaSourceAnalyzer } from '@vulntrace/source-analyzer';
import type { JavaAnalysisResult } from '@vulntrace/source-analyzer';
import { combinePaths, SpringEndpointAnalyzer } from './SpringEndpointAnalyzer.js';
import { parseAnnotationArguments } from './annotationArguments.js';

const parser = new LightweightJavaParser();

function analyzeSources(sources: Record<string, string>, sourceSet: SourceSet = 'MAIN') {
  const analysis: JavaAnalysisResult = {
    projectPath: '/repo',
    files: Object.entries(sources).map(([filePath, content]) => ({
      ...parser.parse(filePath, content),
      sourceSet,
    })),
    skippedFiles: [],
    warnings: [],
  };
  return new SpringEndpointAnalyzer().analyze(analysis);
}

const routes = (result: ReturnType<typeof analyzeSources>): string[] =>
  result.endpoints.map((e) => `${e.httpMethod} ${e.path} -> ${e.controllerClass}#${e.controllerMethod}`);

const SPRING_IMPORTS = `
import org.springframework.web.bind.annotation.*;
`;

describe('parseAnnotationArguments', () => {
  it('stores a lone value under `value`', () => {
    expect([...parseAnnotationArguments('"/x"')]).toEqual([['value', [{ kind: 'STRING', value: '/x' }]]]);
  });

  it('reads arrays, named attributes and enum constants', () => {
    const args = parseAnnotationArguments(
      'path = {"/a", "/b"}, method = {RequestMethod.GET, RequestMethod.POST}, produces = "application/json"',
    );
    expect(args.get('path')).toEqual([
      { kind: 'STRING', value: '/a' },
      { kind: 'STRING', value: '/b' },
    ]);
    expect(args.get('method')).toEqual([
      { kind: 'EXPRESSION', text: 'RequestMethod.GET' },
      { kind: 'EXPRESSION', text: 'RequestMethod.POST' },
    ]);
  });

  it('folds string concatenation and decodes escapes', () => {
    expect(parseAnnotationArguments('"/api" + "/v1" + "/q\\"x"').get('value')).toEqual([
      { kind: 'STRING', value: '/api/v1/q"x' },
    ]);
  });

  it('keeps non-literal values as expression text', () => {
    expect(parseAnnotationArguments('Paths.BASE + "/x"').get('value')).toEqual([
      { kind: 'EXPRESSION', text: 'Paths.BASE + "/x"' },
    ]);
  });

  it('returns nothing for missing or empty arguments', () => {
    expect(parseAnnotationArguments(undefined).size).toBe(0);
    expect(parseAnnotationArguments('  ').size).toBe(0);
  });
});

describe('combinePaths', () => {
  it.each([
    ['/api', '/render', '/api/render'],
    ['/api/', '/render', '/api/render'],
    ['api', 'render', '/api/render'],
    ['/api', '', '/api'],
    ['', '/hello', '/hello'],
    ['', '', '/'],
    ['/users', '/{id}', '/users/{id}'],
  ])('%s + %s = %s', (classPath, methodPath, expected) => {
    expect(combinePaths(classPath, methodPath)).toBe(expected);
  });
});

describe('SpringEndpointAnalyzer', () => {
  it('combines the class-level @RequestMapping with method shortcuts', () => {
    const result = analyzeSources({
      'src/main/java/com/example/TemplateController.java': `
package com.example;
${SPRING_IMPORTS}
@RestController
@RequestMapping("/api/templates")
public class TemplateController {
    @PostMapping("/render")
    public String render(@RequestBody String template) { return template; }

    @GetMapping
    public String list() { return ""; }

    @PutMapping(value = "/{id}")
    public void update(@PathVariable String id) {}

    @DeleteMapping(path = "/{id}")
    public void delete(@PathVariable String id) {}

    @PatchMapping("/{id}")
    public void patch(@PathVariable String id) {}

    public void helper() {}
}
`,
    });

    expect(routes(result)).toEqual([
      'GET /api/templates -> com.example.TemplateController#list',
      'POST /api/templates/render -> com.example.TemplateController#render',
      'DELETE /api/templates/{id} -> com.example.TemplateController#delete',
      'PATCH /api/templates/{id} -> com.example.TemplateController#patch',
      'PUT /api/templates/{id} -> com.example.TemplateController#update',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('keeps evidence: controller, class mapping, method mapping and method location', () => {
    const result = analyzeSources({
      'src/main/java/com/example/LoginController.java': `package com.example;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class LoginController {
    @PostMapping(
        "/login"
    )
    public String login() { return ""; }
}
`,
    });

    const [endpoint] = result.endpoints;
    expect(endpoint).toEqual({
      httpMethod: 'POST',
      path: '/api/login',
      controllerClass: 'com.example.LoginController',
      controllerMethod: 'login',
      location: { filePath: 'src/main/java/com/example/LoginController.java', line: 12, column: 19 },
      unresolved: [],
      evidence: {
        controller: {
          annotation: '@RestController',
          location: { filePath: 'src/main/java/com/example/LoginController.java', line: 6, column: 1 },
        },
        classMapping: {
          annotation: '@RequestMapping("/api")',
          location: { filePath: 'src/main/java/com/example/LoginController.java', line: 7, column: 1 },
        },
        methodMapping: {
          annotation: '@PostMapping("/login")',
          location: { filePath: 'src/main/java/com/example/LoginController.java', line: 9, column: 5 },
        },
      },
      security: [],
    });
  });

  it('records access annotations on the handler and controller, resolved through imports (Phase 7)', () => {
    const result = analyzeSources({
      'src/main/java/com/example/AdminController.java': `
package com.example;
${SPRING_IMPORTS}
import org.springframework.security.access.prepost.PreAuthorize;
import jakarta.annotation.security.RolesAllowed;
@RestController
@RolesAllowed("ADMIN")
public class AdminController {
    @PreAuthorize("hasRole('ADMIN')")
    @GetMapping("/admin")
    public String admin() { return ""; }

    @PreAuthorize("permitAll()")
    @GetMapping("/open")
    public String open() { return ""; }
}
`,
      'src/main/java/com/example/Custom.java': `
package com.example;
${SPRING_IMPORTS}
import com.acme.Secured;
@RestController
public class Custom {
    @Secured("X")
    @GetMapping("/custom")
    public String custom() { return ""; }
}
`,
    });
    const security = (path: string) =>
      result.endpoints.find((e) => e.path === path)?.security?.map((s) => s.annotation);
    expect(security('/admin')).toEqual(['@PreAuthorize("hasRole(\'ADMIN\')")', '@RolesAllowed("ADMIN")']);
    // permitAll() grants access, so only the class-level annotation protects it.
    expect(security('/open')).toEqual(['@RolesAllowed("ADMIN")']);
    // A same-named custom annotation is not Spring Security's.
    expect(security('/custom')).toEqual([]);
  });

  it('reads @RequestMapping method attributes, including static imports and multiple paths', () => {
    const result = analyzeSources({
      'src/main/java/com/example/A.java': `
package com.example;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import static org.springframework.web.bind.annotation.RequestMethod.DELETE;

@Controller
public class A {
    @RequestMapping(value = {"/a", "/b"}, method = {RequestMethod.GET, RequestMethod.POST})
    public String ab() { return "view"; }

    @RequestMapping(path = "/c", method = DELETE)
    public String c() { return "view"; }

    @RequestMapping("/any")
    public String any() { return "view"; }
}
`,
    });

    expect(routes(result)).toEqual([
      'GET /a -> com.example.A#ab',
      'POST /a -> com.example.A#ab',
      'ANY /any -> com.example.A#any',
      'GET /b -> com.example.A#ab',
      'POST /b -> com.example.A#ab',
      'DELETE /c -> com.example.A#c',
    ]);
  });

  it('unions class-level and method-level HTTP methods like Spring does', () => {
    const result = analyzeSources({
      'src/main/java/com/example/B.java': `
package com.example;
${SPRING_IMPORTS}
@RestController
@RequestMapping(path = "/b", method = RequestMethod.POST)
public class B {
    @GetMapping("/x") public String x() { return ""; }
    @RequestMapping("/y") public String y() { return ""; }
}
`,
    });
    expect(routes(result)).toEqual([
      'GET /b/x -> com.example.B#x',
      'POST /b/x -> com.example.B#x',
      'POST /b/y -> com.example.B#y',
    ]);
  });

  it('records constant paths as unresolved instead of guessing', () => {
    const result = analyzeSources({
      'src/main/java/com/example/C.java': `
package com.example;
${SPRING_IMPORTS}
@RestController
@RequestMapping(ApiPaths.USERS)
public class C {
    @GetMapping("/" + "me") public String me() { return ""; }
    @RequestMapping(value = "/z", method = SOME_METHOD) public String z() { return ""; }
}
`,
    });
    expect(result.endpoints.map((e) => [e.httpMethod, e.path, e.unresolved])).toEqual([
      ['GET', '/${ApiPaths.USERS}/me', ['ApiPaths.USERS']],
      ['ANY', '/${ApiPaths.USERS}/z', ['ApiPaths.USERS', 'SOME_METHOD']],
    ]);
  });

  it('accepts fully qualified annotations', () => {
    const result = analyzeSources({
      'src/main/java/com/example/D.java': `
package com.example;
@org.springframework.web.bind.annotation.RestController
public class D {
    @org.springframework.web.bind.annotation.GetMapping("/d") public String d() { return ""; }
}
`,
    });
    expect(routes(result)).toEqual(['GET /d -> com.example.D#d']);
  });

  it('ignores same-named annotations that are not Spring', () => {
    const result = analyzeSources({
      'src/main/java/com/example/E.java': `
package com.example;
import com.acme.web.RestController;
import com.acme.web.GetMapping;
@RestController
public class E {
    @GetMapping("/e") public String e() { return ""; }
}
`,
    });
    expect(result.endpoints).toEqual([]);
  });

  it('ignores mappings outside controller classes and test sources', () => {
    const notController = analyzeSources({
      'src/main/java/com/example/F.java': `
package com.example;
${SPRING_IMPORTS}
@RequestMapping("/f")
public class F {
    @GetMapping("/x") public String x() { return ""; }
}
`,
    });
    expect(notController.endpoints).toEqual([]);

    const testSource = analyzeSources(
      {
        'src/test/java/com/example/G.java': `
package com.example;
${SPRING_IMPORTS}
@RestController
public class G { @GetMapping("/g") public String g() { return ""; } }
`,
      },
      'TEST',
    );
    expect(testSource.endpoints).toEqual([]);
  });

  it('handles nested controller classes with their own qualified name', () => {
    const result = analyzeSources({
      'src/main/java/com/example/Outer.java': `
package com.example;
${SPRING_IMPORTS}
public class Outer {
    @RestController
    @RequestMapping("/inner")
    public static class Inner {
        @GetMapping("/x") public String x() { return ""; }
    }
}
`,
    });
    expect(routes(result)).toEqual(['GET /inner/x -> com.example.Outer.Inner#x']);
  });

  it('warns when a method carries more than one mapping annotation', () => {
    const result = analyzeSources({
      'src/main/java/com/example/H.java': `
package com.example;
${SPRING_IMPORTS}
@RestController
public class H {
    @GetMapping("/h")
    @PostMapping("/h")
    public String h() { return ""; }
}
`,
    });
    expect(routes(result)).toEqual(['GET /h -> com.example.H#h']);
    expect(result.warnings).toEqual([
      'src/main/java/com/example/H.java:10: H.h has 2 mapping annotations; using @GetMapping("/h")',
    ]);
  });

  it('prefers a directly present @RequestMapping over shortcut annotations, as Spring does', () => {
    const result = analyzeSources({
      'src/main/java/com/example/Cors.java': `
package com.example;
${SPRING_IMPORTS}
@RestController
@RequestMapping("/cors")
public class Cors {
    @GetMapping("*")
    @RequestMapping("/vuln/crossOrigin")
    public String vuls3() { return ""; }
}
`,
    });
    expect(routes(result)).toEqual(['ANY /cors/vuln/crossOrigin -> com.example.Cors#vuls3']);
    expect(result.warnings).toEqual([
      'src/main/java/com/example/Cors.java:11: Cors.vuls3 has 2 mapping annotations; using @RequestMapping("/vuln/crossOrigin")',
    ]);
  });
});

describe('SpringEndpointAnalyzer on fixtures', () => {
  const fixturePath = (name: string): string =>
    fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

  async function fixtureRoutes(name: string): Promise<string[]> {
    const analysis = await new LightweightJavaSourceAnalyzer().analyzeProject(fixturePath(name));
    if (!analysis.ok) throw analysis.error;
    return routes(new SpringEndpointAnalyzer().analyze(analysis.value));
  }

  it('finds the reachable fixture entry point', async () => {
    expect(await fixtureRoutes('spring-vulnerable-reachable')).toEqual([
      'GET /api/hello -> com.example.demo.HelloController#hello',
      'POST /api/templates/render -> com.example.demo.TemplateController#render',
    ]);
  });

  it('finds only the hello endpoint in the other fixtures', async () => {
    for (const name of ['spring-safe-app', 'spring-vulnerable-unused', 'spring-vulnerable-used']) {
      expect(await fixtureRoutes(name)).toEqual(['GET /api/hello -> com.example.demo.HelloController#hello']);
    }
  });
});
