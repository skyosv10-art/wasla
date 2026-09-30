# RISK-0056 pg_trgm Resolution — READ ONLY

- **Claim:** `CLM-0412` · **Work item:** M6-18B (stays **Blocked**) · **Risk:** RISK-0056 (stays **open**) · **Blocker:** B1 (`pg_trgm`)
- **Branch:** `ops/risk-0056-pgtrgm-readonly` · **Workflow:** `.github/workflows/risk-0056-pgtrgm-readonly.yml` · **Probe:** `scripts/ops/risk-0056/pgtrgm-probe.mjs`
- **Runs:** [36658467944](https://github.com/skyosv10-art/wasla/actions/runs/36658467944) (probes OK; replay step stopped by its own input guard on the backslash in Supabase's `search_path`), [36658728822](https://github.com/skyosv10-art/wasla/actions/runs/36658728822) (success, all steps)
- **Refs:** production `snlpxywskyqrjattbpgn` · test `obeptvwpvqbduwkahorq`. Nothing else identifying printed; leak scan of the full logs: 0 connection strings, 0 pooler hosts, 0 tokens.
- **Nothing changed:** no `CREATE EXTENSION`, no DDL/DML on production, no Render change, `schema.sql` and migrations untouched, PR #549 not merged, RISK-0012/0013/0042 untouched.

## Read-only guarantee

Both Supabase sessions (production via `SUPABASE_DB_URL`, test via `SUPABASE_TEST_DB_URL`, both session pooler): `SET default_transaction_read_only = on` → `SHOW default_transaction_read_only` = `on` → in `BEGIN`, `SHOW transaction_read_only` = `on` → canary `CREATE TEMP TABLE` **rejected 25006** → only then reads, inside `BEGIN READ ONLY … ROLLBACK`. Log: `read-only proof: … → PROVEN` for `[production]` and `[test]`.

## 1. Exact statements (from the file, not docs)

`services/search/contracts/schema.sql`:

```
36:BEGIN;
39:CREATE EXTENSION IF NOT EXISTS pg_trgm;
84:CREATE INDEX IF NOT EXISTS ix_search_products_trgm_ar
85:    ON search_product_index
86:    USING gin (title_ar gin_trgm_ops);
264:COMMIT;
```

No `SCHEMA` clause, no `SET search_path`, `gin_trgm_ops` unqualified, all inside one transaction. Runtime use: `services/search/src/infrastructure/search-index-reader.ts:88` — `"title_ar % $1"` (operator `%`, unqualified). No other pg_trgm object is referenced by schema.sql.

## 2–4. Production facts (identical on the test project)

| Item | Production | Test project |
|---|---|---|
| Server | 17.6 | 17.6 |
| current_user / session_user | postgres / postgres | postgres / postgres |
| `SHOW search_path` | `"\$user", public, extensions` | same |
| Source of search_path | `pg_db_role_setting`: role `postgres`, all databases | same |
| `current_schema()` | **public** | public |
| `current_schemas(true)` | `{pg_catalog,public,extensions}` | same |
| Schema `extensions` | exists · owner `postgres` · ACL `postgres=UC, anon=U, authenticated=U, service_role=U, dashboard_user=UC` | same |
| Extensions in `extensions` | pg_stat_statements, pgcrypto, uuid-ossp | same |
| `pg_trgm` available | yes · default **1.6** | yes · 1.6 |
| `pg_trgm` installed | **no** | **yes · 1.6 · schema `public`** (by the unchanged migration, CLM-0410) |
| Control data (1.6) | superuser=true · **trusted=true** · relocatable=true · fixed schema=none · requires=none | same |
| Role attributes | rolsuper=false · createdb/createrole/bypassrls=true · member of `supabase_privileged_role` | same |
| `has_database_privilege(CREATE)` | true | true |
| `has_schema_privilege` public USAGE/CREATE | true / true | true / true |
| `has_schema_privilege` extensions USAGE/CREATE | true / true | true / true |
| `supautils.privileged_extensions` | **includes `pg_trgm`** · executed as `supabase_admin` | same |
| session_preload_libraries | `supautils` | same |
| `gin_trgm_ops`, `%`(text,text), `similarity` | absent | all in `public` |

Can the migration role create it from SQL? Yes by two independent paths, both evidenced: pg_trgm is `trusted` and the role has CREATE on the database; and supautils lists pg_trgm as a privileged extension it runs as `supabase_admin`. Empirical proof: the same role, same search_path and same supautils list on the test project created it through this exact statement (CLM-0410, run 36652155317).

## 5. Placement and usability (answered)

- **Where:** with no `SCHEMA` clause and no fixed schema in the control file, PostgreSQL creates a relocatable extension in the current creation schema, `current_schema()` = first existing schema of the search_path. `"\$user"` (a literal schema name) does not exist ⇒ **`public`**. Proven three ways: production `current_schema()` = public; test project (identical config) has pg_trgm@1.6 in `public`; runner replay (postgres:17 with production search_path + an `extensions` schema) placed it in `public`.
- **Usable in the same migration session:** yes. `public` is in the search_path, so `gin_trgm_ops` resolves inside the same transaction; replay created `CREATE INDEX ix_search_products_trgm_ar ON public.search_product_index USING gin (title_ar gin_trgm_ops)`, and a new session resolved `'abc' % 'abd'` → t, `similarity` → 0.333. The test project ran the whole search migration successfully twice.
- **Pooler:** session mode binds one backend for the whole connection; search_path comes from the role setting applied at backend login, not from the client, and the migration sends schema.sql as one multi-statement query on one connection ⇒ placement is deterministic. Nothing observed makes it unsafe.

## 6. Residual unknown (not guessed)

The search service's runtime role/search_path on Render was not read (Render is out of scope). Placement in `public` does not depend on it: `public` is in PostgreSQL's default search_path and in the observed `postgres` role path.

## 7. Recommendation (one)

**Keep the current migration statement unchanged.** Reasons from evidence: (1) production's role, search_path, privileges and supautils configuration are identical to the test project, where this exact statement already succeeded and produced a working search service (`/health` ok, 14/14 parity); (2) placement is deterministic (`public`) and every pg_trgm object used — `gin_trgm_ops` in schema.sql and `%` at runtime — resolves through the existing search_path in the same session; (3) changing to `SCHEMA extensions` would make production diverge from the already-proven test state and require a new schema.sql change and re-proof; pre-enabling separately adds an out-of-pipeline manual production step. Known trade-off, recorded not acted on: Supabase's advisor flags extensions in `public`; exposure is low because API roles have no USAGE on `public` (CLM-0411), and pg_trgm is relocatable should the owner later decide otherwise.

B1 status: **resolved as an information blocker** — the statement will work on production; applying it still needs the owner's explicit approval together with the rest of RISK-0056.
