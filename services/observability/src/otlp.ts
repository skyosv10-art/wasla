// OTLP trace receiver — accepts OpenTelemetry traces via HTTP/JSON
// Replaces the OTLP collector for staging verification

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  attributes: Record<string, string>;
}

class OtlpReceiver {
  private traces: TraceSpan[] = [];
  private maxTraces = 1000;

  // Handle POST /v1/traces — OTLP HTTP/JSON format
  receiveTraces(body: any): { accepted: number; total: number } {
    const resourceSpans = body.resourceSpans || [];
    let accepted = 0;

    for (const rs of resourceSpans) {
      const resourceAttrs = rs.resource?.attributes || [];
      const serviceName = this.getAttrValue(resourceAttrs, 'service.name') || 'unknown';

      for (const ss of rs.scopeSpans || []) {
        for (const span of ss.spans || []) {
          const traceSpan: TraceSpan = {
            traceId: span.traceId || '',
            spanId: span.spanId || '',
            parentSpanId: span.parentSpanId,
            name: span.name || 'unnamed',
            service: serviceName,
            startTime: parseInt(span.startTimeUnixNano || '0') / 1e6,
            endTime: parseInt(span.endTimeUnixNano || '0') / 1e6,
            durationMs: span.endTimeUnixNano && span.startTimeUnixNano
              ? (parseInt(span.endTimeUnixNano) - parseInt(span.startTimeUnixNano)) / 1e6
              : 0,
            attributes: {},
          };

          // Extract span attributes
          for (const attr of span.attributes || []) {
            const val = attr.value?.stringValue || String(attr.value?.intValue || attr.value?.doubleValue || '');
            traceSpan.attributes[attr.key] = val;
          }

          this.traces.push(traceSpan);
          accepted++;
        }
      }
    }

    // Trim old traces
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-this.maxTraces);
    }

    if (accepted > 0) {
      console.log('[otlp] Received %d spans from %d resource groups (total: %d)', accepted, resourceSpans.length, this.traces.length);
    }

    return { accepted, total: this.traces.length };
  }

  private getAttrValue(attrs: any[], key: string): string | undefined {
    for (const attr of attrs) {
      if (attr.key === key) {
        return attr.value?.stringValue || String(attr.value?.intValue || attr.value?.doubleValue || '');
      }
    }
    return undefined;
  }

  getTraces(): TraceSpan[] {
    return this.traces;
  }

  getTraceCount(): number {
    return this.traces.length;
  }

  getRecentTraces(limit = 20): TraceSpan[] {
    return this.traces.slice(-limit);
  }
}

export const otlpReceiver = new OtlpReceiver();
