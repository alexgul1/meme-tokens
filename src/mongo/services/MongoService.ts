import {MongoClient, Db, Collection, ConnectionOptions} from 'mongodb';
import { IMongoService } from './IMongoService';
import { Token } from '../types/Token';
import dotenv from 'dotenv';

dotenv.config();

export class MongoService implements IMongoService<Token> {
	private static client: MongoClient | null = null;
	private db: Db | null = null;
	private readonly uri: string;
	private readonly dbName: string;
	private readonly collectionName: string;
	private readonly finishedCollectionName: string;
	private readonly testTGCollectionName: string;


	constructor() {
		this.uri = process.env.MONGODB_URI as string;
		this.dbName = process.env.DB_NAME as string;
		this.collectionName = process.env.COLLECTION_NAME as string;
		this.finishedCollectionName = process.env.FINISHED_COLLECTION_NAME as string;
		this.testTGCollectionName = process.env.TEST_TG_COLLECTION_NAME as string;


		if (!this.uri || !this.dbName || !this.collectionName || !this.finishedCollectionName) {
			throw new Error('Environment variables MONGODB_URI, DB_NAME, FINISHED_COLLECTION_NAME and COLLECTION_NAME must be set');
		}
	}

	private async initializeClient(): Promise<void> {
		if (!MongoService.client) {
			MongoService.client = new MongoClient(this.uri, {} as ConnectionOptions);
			await MongoService.client.connect();
			this.db = MongoService.client.db(this.dbName);
			console.log('Connected to MongoDB');
		}
	}

	public async connect(retries = 5, delay = 5000): Promise<void> {
		for (let i = 0; i < retries; i++) {
			try {
				await this.initializeClient();
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
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this.collectionName);
		await collection.insertOne(entity);
	}

	public async updateEntity(key: string, value: unknown, update: Partial<Token>): Promise<void> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this.collectionName);
		await collection.updateOne({ [key]: value }, { $set: update });
	}

	public async getEntity(key: string, value: unknown): Promise<Token | null> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this.collectionName);
		return await collection.findOne({ [key]: value });
	}

	public async getEntitiesByValue(key: string, value: unknown): Promise<Token[]> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this.collectionName);
		return await collection.find({ [key]: value }).toArray();
	}

	public async getEntityFromFinishedCollection(object: Record<string, unknown>): Promise<Token | null> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this.finishedCollectionName);
		return await collection.findOne(object);
	}

	public async finishTokenSubscription(key: string, value: unknown): Promise<void> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}

		const collection: Collection<Token> = this.db.collection(this.collectionName);
		const activeToken = await collection.findOne({ [key]: value });

		if (activeToken?.status === 'Finished') {
			const finishedCollection = this.db.collection(this.finishedCollectionName);

			await finishedCollection.insertOne(activeToken);
			await collection.deleteOne({ [key]: value });
		}
	}

	public async insertTelegramMessageInfo(object: Record<string, unknown>): Promise<void> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}

		if (!this.testTGCollectionName) {
			return ;
		}
		const collection: Collection = this.db.collection(this.testTGCollectionName);
		await collection.insertOne(object);
	}

	public async close(): Promise<void> {
		if (MongoService.client) {
			await MongoService.client.close();
			MongoService.client = null;
			this.db = null;
			console.log('Disconnected from MongoDB');
		}
	}
}
