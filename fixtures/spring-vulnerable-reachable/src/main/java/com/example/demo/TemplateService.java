package com.example.demo;

import org.apache.commons.text.StringSubstitutor;
import org.springframework.stereotype.Service;

/**
 * Uses the vulnerable API (StringSubstitutor.createInterpolator, CVE-2022-42889).
 * Reached from POST /api/templates/render via TemplateController.render.
 */
@Service
public class TemplateService {

    public String render(String template) {
        StringSubstitutor interpolator = StringSubstitutor.createInterpolator();
        return interpolator.replace(template);
    }
}
