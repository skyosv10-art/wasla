import * as B from "../../../../packages/authz-policy/src/bindings.ts";
import * as O from "../../../../packages/authz-policy/src/operations.ts";
const ops:any[] = (O as any).ENFORCED_OPERATIONS; const bs:any[] = (B as any).OPERATION_BINDINGS;
const by = (f:(b:any)=>string)=>bs.reduce((m:any,b:any)=>(m[f(b)]=(m[f(b)]||0)+1,m),{});
console.log(JSON.stringify({
 ENFORCED_OPERATIONS: ops.length, AUDIENCES: (O as any).AUDIENCES.length,
 OPERATION_BINDINGS: bs.length,
 TOKEN_BOUND_OPERATION_COUNT: (B as any).TOKEN_BOUND_OPERATION_COUNT,
 TENANT_BOUND_OPERATION_COUNT: (B as any).TENANT_BOUND_OPERATION_COUNT,
 UNCLASSIFIED_OPERATION_COUNT: (B as any).UNCLASSIFIED_OPERATION_COUNT,
 by_strength: by(b=>b.strength), by_dimension_strength: by(b=>b.dimension+":"+b.strength),
 none_or_caller: bs.filter(b=>b.strength!=="token-bound").map(b=>`${b.audience} ${b.method} ${b.path} ${b.dimension}:${b.strength}`),
 unclassified_by_audience: ops.filter(o=>!bs.some(b=>b.audience===o.audience&&b.method===o.method&&b.path===o.path)).reduce((m:any,o:any)=>(m[o.audience]=(m[o.audience]||0)+1,m),{}),
}, null, 1));
