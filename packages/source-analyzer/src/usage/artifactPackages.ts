import type { PackageMapping } from '@vulntrace/shared';

/**
 * Known Maven artifact → Java package prefixes (CLAUDE.md §7 Phase 4, plan D2).
 *
 * Only artifacts whose packages differ from their groupId, or that share a groupId with sibling
 * artifacts, need an entry here. Everything else falls back to the groupId heuristic, and the
 * result always records which basis was used. When several dependencies match a class, the
 * longest package prefix wins, so `spring-webmvc` (org.springframework.web.servlet) takes
 * precedence over `spring-web` (org.springframework.web).
 *
 * Future: replace or extend with an index of the actual JAR contents.
 */
const CURATED_PACKAGES: Readonly<Record<string, readonly string[]>> = {
  'org.apache.commons:commons-text': ['org.apache.commons.text'],
  'org.apache.commons:commons-lang3': ['org.apache.commons.lang3'],
  'org.apache.commons:commons-collections4': ['org.apache.commons.collections4'],
  'org.apache.commons:commons-compress': ['org.apache.commons.compress'],
  'commons-lang:commons-lang': ['org.apache.commons.lang'],
  'commons-io:commons-io': ['org.apache.commons.io'],
  'commons-codec:commons-codec': ['org.apache.commons.codec'],
  'commons-collections:commons-collections': ['org.apache.commons.collections'],
  'commons-beanutils:commons-beanutils': ['org.apache.commons.beanutils'],
  'commons-fileupload:commons-fileupload': ['org.apache.commons.fileupload'],
  'commons-logging:commons-logging': ['org.apache.commons.logging'],
  'org.apache.logging.log4j:log4j-api': ['org.apache.logging.log4j'],
  'org.apache.logging.log4j:log4j-core': ['org.apache.logging.log4j.core'],
  'log4j:log4j': ['org.apache.log4j'],
  'ch.qos.logback:logback-classic': ['ch.qos.logback.classic'],
  'ch.qos.logback:logback-core': ['ch.qos.logback.core'],
  'org.slf4j:slf4j-api': ['org.slf4j'],
  'com.fasterxml.jackson.core:jackson-databind': ['com.fasterxml.jackson.databind'],
  'com.fasterxml.jackson.core:jackson-core': ['com.fasterxml.jackson.core'],
  'com.fasterxml.jackson.core:jackson-annotations': ['com.fasterxml.jackson.annotation'],
  'com.google.guava:guava': ['com.google.common', 'com.google.thirdparty'],
  'com.google.code.gson:gson': ['com.google.gson'],
  'org.yaml:snakeyaml': ['org.yaml.snakeyaml'],
  'com.thoughtworks.xstream:xstream': ['com.thoughtworks.xstream'],
  'com.alibaba:fastjson': ['com.alibaba.fastjson'],
  'com.h2database:h2': ['org.h2'],
  'org.springframework:spring-core': [
    'org.springframework.core',
    'org.springframework.util',
    'org.springframework.lang',
  ],
  'org.springframework:spring-beans': ['org.springframework.beans'],
  'org.springframework:spring-aop': ['org.springframework.aop'],
  'org.springframework:spring-expression': ['org.springframework.expression'],
  'org.springframework:spring-context': [
    'org.springframework.context',
    'org.springframework.stereotype',
    'org.springframework.scheduling',
    'org.springframework.cache',
    'org.springframework.validation',
    'org.springframework.format',
    'org.springframework.ui',
  ],
  'org.springframework:spring-web': ['org.springframework.web', 'org.springframework.http'],
  'org.springframework:spring-webmvc': ['org.springframework.web.servlet'],
  'org.springframework:spring-jdbc': ['org.springframework.jdbc'],
  'org.springframework:spring-tx': ['org.springframework.transaction', 'org.springframework.dao'],
  'org.springframework:spring-jcl': ['org.apache.commons.logging'],
};

export function resolvePackageMapping(groupId: string, artifactId: string): PackageMapping {
  const curated = CURATED_PACKAGES[`${groupId}:${artifactId}`];
  if (curated) return { packages: [...curated], basis: 'CURATED' };
  return { packages: [groupId], basis: 'GROUP_ID' };
}
