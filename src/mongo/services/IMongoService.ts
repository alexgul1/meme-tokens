export interface IMongoService<T> {
	connect(): Promise<void>;
	createEntity(entity: T): Promise<void>;
	updateEntity(key: string, value: unknown, update: Partial<T>): Promise<void>;
	getEntity( key: string, value: unknown): Promise<T | null>;
	getEntitiesByValue(key: string, value: unknown): Promise<T[]>;
}
