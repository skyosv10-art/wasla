import type { DispatchDependencies } from "./ports.js";
import {
  type DispatchSharedDeps,
  type DispatchUnitOfWorkDeps,
  PostgresDispatchUnitOfWork,
} from "./infrastructure/drizzle/transaction.js";

export type DispatchWork<T> = (deps: DispatchDependencies) => Promise<T>;

export interface DispatchRunner {
  write<T>(work: DispatchWork<T>): Promise<T>;
  read<T>(work: DispatchWork<T>): Promise<T>;
}

export function createDirectRunner(deps: DispatchDependencies): DispatchRunner {
  return {
    async write<T>(work: DispatchWork<T>): Promise<T> {
      return work(deps);
    },
    async read<T>(work: DispatchWork<T>): Promise<T> {
      return work(deps);
    },
  };
}

export class PostgresDispatchRunner implements DispatchRunner {
  constructor(
    private readonly unitOfWork: PostgresDispatchUnitOfWork,
    private readonly shared: DispatchSharedDeps,
  ) {}

  async write<T>(work: DispatchWork<T>): Promise<T> {
    return this.unitOfWork.run(this.shared, async ({ deps }) => work(deps));
  }

  async read<T>(work: DispatchWork<T>): Promise<T> {
    return this.unitOfWork.read(this.shared, async (deps: DispatchUnitOfWorkDeps) => work(deps));
  }
}
