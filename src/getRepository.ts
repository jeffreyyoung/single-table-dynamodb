import aws from 'aws-sdk';
import { SingleTableDocument } from './SingleTableDocument';
import { ConfigArgs, Index, Config, getConfig, KeyOfStr } from './config';

export type WhereClause<T = any, QueryNames = string> = {
    sort?: 'asc' | 'desc',
    args: Partial<T>,
    index?: QueryNames,
    sortBy?: KeyOfStr<T>,
    cursor?: string,
    limit?: number
}

export type QueryResult<T> = {
    results: T[],
    nextPageArgs: WhereClause<T>
}

let docClient = new aws.DynamoDB.DocumentClient({
    convertEmptyValues: true,
});


/**
 * 
 * Each Local Secondary Index is named lsi1, lsi2, ... or lsi3
 * This function should be used when executing a query with a LSI
 * 
 * @param i 
 */
export function getLSIName<ID, T>(which: number): KeyOfStr<SingleTableDocument<T>> {
    return `lsi${which}` as any;
}

export function getLSISortKeyAttribute<ID, T>(which: number): KeyOfStr<SingleTableDocument<T>> {
    return `lsi${which}` as any;
}

export function getGSIName<ID, T>(which: number): KeyOfStr<SingleTableDocument<T>> {
    return `gsi${which}` as any;
}

export function getGSIAttributeName<ID, T>(which: number, type: 'Sort' | 'Hash'): KeyOfStr<SingleTableDocument<T>> {
    return `gsi${type}${which}` as any;
}

/**
 * 
 * @param thing 
 * @param properties 
 * @param descriptor 
 * @param separator 
 * 
 * return "{descriptor}#{properties[0]}-{thing[properties[0]]}#..."
 */
export function getCompositeKeyValue<ID, T>(thing: T, properties: (keyof T | keyof ID)[], descriptor: string, separator: string) {
    return [
        descriptor,
        ...properties.map(k => dynamoProperty(k as string, thing[k as keyof T] as unknown as string))
    ].join(separator)
}

/**
 * 
 * To make generic dynamo fields more readable, they are saved in the following format
 * <fieldName>-<fieldValue>, eg userId-2039848932
 * 
 * This function should be used whenever saving attributes to a composite index
 * 
 * @param key 
 * @param value 
 */
export function dynamoProperty(key: string, value: string) {
    return `${key}-${value}`;
}

export function getSortkeyForBeginsWithQuery<ID, T>(thing: Partial<T>, indexFields: (keyof T | keyof ID)[], descriptor: string, compositeKeySeparator: string) {
    let fields = [descriptor];
    for (let i = 0; i < indexFields.length; i++) {
        let k = indexFields[i];
        if (k in thing) {
            fields.push(dynamoProperty(k as string, String(thing[k as keyof T])));
        } else {
            break;
        }
    }
    return fields.join(compositeKeySeparator);
}


export function findIndexForQuery<ID, T, QueryNames>(where: WhereClause<T>, config: Config<ID, T, QueryNames>): Index<ID, T> | null {
    if (where.index) {
        if (config.indexesByTag[where.index as unknown as any]) {
            return config.indexesByTag[where.index as unknown as any];
        } else {
            throw `The index "${where.index}" does not exist, the following are valid indexes: ${Object.keys(config.indexesByTag).join(',')}`
        }
    }

    let indexes = config.indexes;

    for (let i = 0; i < indexes.length; i++) {
        let index = indexes[i];
        let neededFields = new Set(Object.keys(where.args) as (keyof ID | keyof T)[]);

        //for this index to be eligible, we need every hashKey field to be provided in the query
        let queryContainsAllHashKeyFields = index.hashKeyFields.every(k => neededFields.has(k));

        //query contains all hash key fields
        if (queryContainsAllHashKeyFields) {
            index.hashKeyFields.forEach(k => neededFields.delete(k));
            const sortKeyFieldIndex = neededFields.size;
            //ensure that the first n fields of this index are included in the where clause
            index.sortKeyFields.slice(0, neededFields.size).forEach(k => neededFields.delete(k));

            //all the specified fields are in the correct place for this index
            if (neededFields.size === 0) {

                //check if this config has a sort and if it's in the right place
                if (where.sortBy) {
                    if (index.sortKeyFields.indexOf(where.sortBy) === sortKeyFieldIndex) {
                        return index;
                    }
                } else {
                    return index;
                }
            }
        }
    }
    return null;
}

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>

function getKey<ID, T>(id: ID | T, i: Index<ID, T>, separator: string): Partial<Omit<SingleTableDocument<T>, 'data'>> {
    return {
        [i.hashKeyAttribute]: getCompositeKeyValue(id as any, i.hashKeyFields as (keyof ID)[], i.hashKeyDescriptor, separator),
        //optionaly include sort key
        ...(
            i.sortKeyFields
            && i.sortKeyFields.length > 0
            && {[i.sortKeyAttribute]: getCompositeKeyValue(id as any, i.sortKeyFields as (keyof ID)[], i.sortKeyDescriptor, separator)}
        )
    }
}

type Queries<T, QueryNames> = Record<Extract<QueryNames, string>, (where: WhereClause<T>) => Promise<QueryResult<T>>>

export type Repository<ID = any, T = any, QueryNames = string> = {
    config: Config<ID, T>,
    getKey: (id: ID) => any,
    get: (id: ID) => Promise<T>,
    update: (id: ID, updates: Partial<T>) => Promise<T>,
    overwrite: (id: ID, thing: T) => Promise<T>,
    delete: (id: ID) => Promise<boolean>,
    formatForDDB: (thing: T) => SingleTableDocument<T>,
    executeQuery: (where: WhereClause<T>, index: Index<ID, T>) => Promise<QueryResult<T>>,
    query: (where: WhereClause<T>) => Promise<QueryResult<T>>,
    queryOne: (where: WhereClause<T>) => Promise<T | null>,
    findIndexForQuery: (where: WhereClause<T>) => Index<ID,T> | null
    queries: Queries<T, QueryNames>
}

export function getRepository<ID, T, QueryNames = string>(args: ConfigArgs<ID, T, QueryNames>): Repository<ID, T, QueryNames> {

    let config = getConfig(args);
    let repo: Repository<ID, T, QueryNames> = {
        get config() {return config;},
        getKey: (id: ID) => {
            return getKey(id, config.primaryIndex, config.compositeKeySeparator);
        },
        get: async (id: ID): Promise<T> => {
            let res = await docClient.get({
                TableName: config.tableName,
                Key: repo.getKey(id)
            }).promise();
            return (res.Item as any).data;
        },
        update: async (id: ID, thing: Partial<T>): Promise<T> => {
            let old = await repo.get(id);
            let updated = { ...old, ...thing };
            return repo.overwrite(id, updated);
        },
        overwrite: async (id: ID, thing: T): Promise<T> => {
            let res = await docClient.put({
                TableName: config.tableName,
                Item: repo.formatForDDB(thing)
            }).promise();

            return thing;
        },
        delete: async (id: ID): Promise<boolean> => {
            let res = await docClient.delete({
                TableName: config.tableName,
                Key: repo.getKey(id)
            }).promise();

            return true;
        },
        executeQuery: async (where: WhereClause<T>, index: Index<ID, T>): Promise<QueryResult<T>> => {
            const hashKey = getCompositeKeyValue<ID, T>(where.args as T, index.hashKeyFields, index.hashKeyDescriptor, config.compositeKeySeparator);
            const sortKey = index.sortKeyFields && getSortkeyForBeginsWithQuery<ID, T>(where.args, index.sortKeyFields, index.sortKeyDescriptor, config.compositeKeySeparator);
            let res = await docClient.query({
                TableName: config.tableName,
                ...(index.indexName && { IndexName: index.indexName }),
                Limit: where.limit || 5,
                KeyConditionExpression: `${index.hashKeyAttribute} = :hKey and begins_with(${index.sortKeyAttribute}, :sKey) `,
                ExpressionAttributeValues: {
                    ':hKey': hashKey,
                    ':sKey': sortKey
                },
                ...(where.cursor && {
                    ExclusiveStartKey: {
                        [index.hashKeyAttribute]: hashKey,
                        [index.sortKeyAttribute]: where.cursor
                    }
                })
            }).promise();

            let nextWhere: WhereClause<T> = { ...where, cursor: (res as any).LastEvaluatedKey[index.sortKeyAttribute] };
            return {
                results: (res as any).Items.map((i: SingleTableDocument<T>) => {
                    return i.data;
                }),
                nextPageArgs: nextWhere
            };
        },
        query: async (where: WhereClause<T>): Promise<QueryResult<T>> => {
            let index = findIndexForQuery<ID, T, QueryNames>(where, config);

            if (!index) {
                throw 'there isnt an index configured for this query';
            }

            return repo.executeQuery(where, index);
        },
        queryOne: async (argsIn: WhereClause<T>): Promise<T | null> => {
            const args = {...argsIn, limit: 1};
            const res = await repo.query(args);
            if (res.results.length > 0) {
                return res.results[0];
            } else {
                return null;
            }
        },
        formatForDDB(thing: T) {
            let obj: Partial<SingleTableDocument<T>> = {
                data: thing,
                objectType: config.objectName
            }

            config.indexes.forEach(i => {
                obj = {
                    ...obj,
                    ...getKey(thing, i, config.compositeKeySeparator)
                }
            });

            return obj as SingleTableDocument<T>;
        },
        findIndexForQuery: (where: WhereClause<T>) => {
            return findIndexForQuery<ID, T, QueryNames>(where, config);
        },
        queries: Object.keys(config.indexesByTag).reduce((obj: any, key: string) => {
            obj[key] = (where: WhereClause<T>) => repo.executeQuery(where, config.indexesByTag[key]);
            return obj;
        }, {}) as Queries<T, QueryNames>
    }
    return repo;
}

