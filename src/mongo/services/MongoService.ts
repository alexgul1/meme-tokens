
import { MongoClient, Db, Collection, ConnectionOptions } from 'mongodb';

import { IMongoService } from './IMongoService';
import { Token } from '../types/Token';
import dotenv from 'dotenv';

dotenv.config();

export class MongoService implements IMongoService<Token> {
	private client: MongoClient;
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	//@ts-ignore
	private db: Db;
	private readonly uri: string;
	private readonly dbName: string;
	private readonly collectionName: string;

	constructor() {
		this.uri = process.env.MONGODB_URI as string;
		this.dbName = process.env.DB_NAME as string;
		this.collectionName = process.env.COLLECTION_NAME as string;

		if (!this.uri || !this.dbName || !this.collectionName) {
			throw new Error('Environment variables MONGODB_URI, DB_NAME, and COLLECTION_NAME must be set');
		}

		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		this.client = new MongoClient(this.uri, {  } as ConnectionOptions);
	}

	public async connect(retries = 5, delay = 5000): Promise<void> {
		for (let i = 0; i < retries; i++) {
			try {
				await this.client.connect();
				this.db = this.client.db(this.dbName);
				console.log('Connected to MongoDB');
				return;
			} catch (error) {
				console.error('Failed to connect to MongoDB', error);
				if (i < retries - 1) {
					console.log(`Retrying in ${delay / 1000} seconds...`);
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		}
		throw new Error('Failed to connect to MongoDB after multiple attempts');
	}

	public async createEntity(entity: Token): Promise<void> {
		const collection: Collection<Token> = this.db.collection(this.collectionName);
		await collection.insertOne(entity);
	}

	public async updateEntity(key: string, value: unknown, update: Partial<Token>): Promise<void> {
		const collection: Collection<Token> = this.db.collection(this.collectionName);
		await collection.updateOne({ [key]: value }, { $set: update });
	}

	public async getEntity(key: string, value: unknown): Promise<Token | null> {
		const collection: Collection<Token> = this.db.collection(this.collectionName);
		return await collection.findOne({ [key]: value });
	}

	public async getEntitiesByValue(key: string, value: unknown): Promise<Token[]> {
		const collection: Collection<Token> = this.db.collection(this.collectionName);
		return await collection.find({ [key]: value }).toArray();
	}

	public async close(): Promise<void> {
		await this.client.close();
	}
}
