export interface IMongoService<T> {
	connect(): Promise<void>;
	createEntity(entity: T): Promise<void>;
	updateEntity(object: Record<string, unknown>, update: Partial<T>): Promise<void>;
	getEntity(object: Record<string, unknown>): Promise<T | null>;
	getEntitiesByValue(key: string, value: unknown): Promise<T[]>;
}
