import {MongoClient, Db, Collection, ConnectionOptions} from 'mongodb';
import { IMongoService } from './IMongoService';
import { Token } from '../types/Token';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

dotenv.config();

export class MongoService implements IMongoService<Token> {
	private static client: MongoClient | null = null;

	private db: Db | null = null;
	private readonly uri: string;
	private readonly dbName: string;
	private readonly collectionName: string;
	private readonly finishedCollectionName: string;
	private readonly collectionNameV2: string;
	private readonly finishedCollectionNameV2: string;
	private readonly testTGCollectionName: string;
	private readonly version: number;


	constructor(version = 1) {
		this.uri = process.env.MONGODB_URI as string;
		this.dbName = process.env.DB_NAME as string;
		this.collectionName = process.env.COLLECTION_NAME as string;
		this.finishedCollectionName = process.env.FINISHED_COLLECTION_NAME as string;
		this.collectionNameV2 = process.env.COLLECTION_NAME_V2 as string;
		this.finishedCollectionNameV2 = process.env.FINISHED_COLLECTION_NAME_V2 as string;

		this.testTGCollectionName = process.env.TEST_TG_COLLECTION_NAME as string;

		this.version = version;

		if (!this.uri || !this.dbName || !this.collectionName || !this.finishedCollectionName) {
			throw new Error('Environment variables MONGODB_URI, DB_NAME, FINISHED_COLLECTION_NAME and COLLECTION_NAME must be set');
		}
	}

	private get _collectionName() {
		return this.version === 1 ? this.collectionName : this.collectionNameV2;
	}

	private get _finishedCollectionName() {
		return this.version === 1 ? this.finishedCollectionName : this.finishedCollectionNameV2;
	}


	private async initializeClient(): Promise<void> {
		if (!MongoService.client) {
			MongoService.client = new MongoClient(this.uri, {} as ConnectionOptions);
			await MongoService.client.connect();
			console.log('Connected to MongoDB');
		}

		if (!this.db) {
			this.db = MongoService.client.db(this.dbName);
		}
	}

	public async connect(retries = 5, delay = 5000): Promise<void> {
		for (let i = 0; i < retries; i++) {
			try {
				await this.initializeClient();
				return;
			} catch (error) {
				Sentry.captureException({message: 'Failed to connect to MongoDB', error});

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
		const collection: Collection<Token> = this.db.collection(this._collectionName);
		await collection.insertOne(entity);
	}

	public async updateEntity(key: string, value: unknown, update: Partial<Token>): Promise<void> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this._collectionName);
		await collection.updateOne({ [key]: value }, { $set: update });
	}

	public async getEntity(key: string, value: unknown): Promise<Token | null> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this._collectionName);
		return await collection.findOne({ [key]: value });
	}

	public async getEntitiesByValue(key: string, value: unknown): Promise<Token[]> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this._collectionName);
		return await collection.find({ [key]: value }).toArray();
	}

	public async getEntityFromFinishedCollection(object: Record<string, unknown>): Promise<Token | null> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}
		const collection: Collection<Token> = this.db.collection(this._finishedCollectionName);
		return await collection.findOne(object);
	}

	public async finishTokenSubscription(object: Record<string, unknown>): Promise<void> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}

		const collection: Collection<Token> = this.db.collection(this._collectionName);
		const activeToken = await collection.findOne(object);

		if (activeToken?.status === 'Finished') {
			const finishedCollection = this.db.collection(this._finishedCollectionName);

			await finishedCollection.insertOne(activeToken);
			await collection.deleteOne(object);
		}
	}

	public async insertTelegramMessageInfo(isIncluded: boolean, hasTokenAddress: boolean): Promise<void> {
		if (!this.db) {
			throw new Error('Database connection is not established');
		}

		if (!this.testTGCollectionName) {
			return ;
		}

		const collection: Collection = this.db.collection(this.testTGCollectionName);

		const entity = (await collection.findOne({ 'key': 'telegram' }))!;


		const update = {
			...(isIncluded ? {includeCount: ++entity.includeCount} : {excludeCount: ++entity.excludeCount}),
			...(hasTokenAddress && {tokenAddressCount: ++entity.tokenAddressCount}),
			date: new Date()
		}

		await collection.updateOne({ 'key': 'telegram' }, {
			$set: update
		});
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
