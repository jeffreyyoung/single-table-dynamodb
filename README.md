# Single Table Dynamodb

Right now this library is an experiment 👨‍🔬

There are a few other dynamodb clients that help simplify using dynamodb in a node environment, but they all encourage the use of multiple tables.  This client is built with the idea that all application data stored in dynamodb should be stored in a single table. https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html

## Getting Started


### First create a table
```javascript
import { createTable } from 'single-table-dynamo';

//create a table, you should only run this function once to setup the table
await createTable();

```


### Next create a repository
For each type of object (e.g. user, event, post) there should be a different repo (e.g. userRepo, eventRepo, postRepo)

```javascript

import { getRepository} from 'single-table-dynamo';

//create a repository that stores a specific type of object into the table
const userRepo = getRepository({
    hashKeyFields: ['id'], //specify which properties of the object make up the id
    objectName: 'User' //specify a unique name for this object
});

let user1 = await userRepo.create({id: 1, name: 'halpert'});
let user2 = await userRepo.create({id: 2, name: 'beasley'});
let halpert = await userRepo.get({id: 1});

console.log(halper)// {id:1, name: 'halper'}

await userRepo.delete({id: 1}); //bye jim
console.log(await userRepo.get({id: 1})) //null
```

### Advanced usage with typescript

```typescript

import { getRepository} from 'single-table-dynamo';

//create a type the represent the ID for this object
//these fields are required to get/update an item
type PurchaseId = {
    id: string
    itemId: string
    userId: string
}

//additional meta data
type Purchase = PurchaseId & {
    purchaseTime: number
    country: string
    state: string
    city: string
}

type QueryKeys = 'getPurchasersOfItem' | 'latestPurchases' | 'location' | 'latestPurchasesByCountry'

const repo = getRepository<PurchaseID, Purchase, 'getPurchasersOfItem' | 'latestPurchases' | 'location' | 'latestPurchasesByCountry'>({
    objectName: 'Purchase',
    hashKeyFields: ['userId'],
    sortKeyFields: ['itemId', 'id'],
    queries: {
        getMyPurchases: {
            isPrimary: true
        },
        //these queries will use Global Secondary indexes
        getPurchasersOfItem: {
            which: 0,
            hashKeyFields: ['itemId'],
            sortKeyFields: ['purchaseDate', 'userId']
        },
        latestPurchasersOfItemByCountry: {
            which: 1,
            hashKeyFields: ['itemId'],
            sortKeyFields: ['country', 'state', 'city']
        },
        latestPurchasesInCountry: {
            which: 2,
            hashKeyFields: ['country'],
            sortKeyFields: ['purchaseDate']
        },


        //these queries will use Local Secondary Indexes
        latestPurchases: {
            sortKeyFields: ['purchaseDate', 'itemId'],
            which: 0
        },
        purchasesByLocation: {
            which: 1,
            sortKeyFields: ['country', 'state', 'city', 'purchaseDate', 'itemId']
        },
        latestPurchasesByCountry: {
            which: 1,
            sortKeyFields: ['country', 'purchaseDate']
        }
    }
});


let purchase1 = await repo.create({
    id: '1',
    itemId: 'scuba-tank',
    userId: 'creed',
    purchaseTime: (new Date()).getTime(),
    country: 'usa',
    state: 'pa',
    city: 'scranton'
});

let purchase2 = await repo.create({
    id: '2',
    itemId: 'cat-food',
    userId: 'angela',
    purchaseTime: (new Date()).getTime(), //now
    country: 'usa',
    state: 'ks',
    city: 'otis'
})

//get the latest purchases purchased in the usa
let {results} = await repo.queries.latestPurchasesInCountry({
    args: {country: 'usa'}
});
console.log(results); // [ {id: '1', ...}, {id: '2', ...}]

//get all of angela's latest purchases
let {results} = await repo.queries.latestPurchases({
    args: {userId: 'angela'}
});
console.log(results); // [{id: '2',itemId: 'cat-food',userId: 'angela'...}]

//you can also call repo.query() which will guess which index to use for a query
let {results} = await repo.query({
    args: {userId: 'creed'}
});
//returns creed's purchases
console.log(results) // [{id: '1', userId: 'creed', ...}];

//if you call repo.query(), and not enough information is passed in to find
//an suitable index, an error will be thrown
let {results} = await repo.query({
    args: {city: 'scranton'}
})
//throws 'there is not a suitable index for this query'
```





## How it works

Everything stored in the table have the below shape.

The dynamo table is configured to have a local secondary index on the fields `lsi0`, `lsi1`,...`lsi4`.  And a global secondary index on the fields `gsiHash0`, `gsiSort0`,...`gsiHash19`, `gsiSort19`
```typescript

export type SingleTableDocument<T> = {
    hashKey: string
    sortKey?: string

    data: T
    objectType: string

    //sparse local secondary indexes that may or not be defined
    lsi0?: string
    lsi1?: string
    lsi2?: string
    lsi3?: string
    lsi4?: string

    //sparse global indexes that may or not be defined
    gsiHash0?: string
    gsiSort0?: string

    gsiHash1?: string
    gsiSort1?: string

    gsiHash2?: string
    gsiSort2?: string

    gsiHash3?: string
    gsiSort3?: string

    gsiHash4?: string
    gsiSort4?: string

    gsiHash5?: string
    gsiSort5?: string

    gsiHash6?: string
    gsiSort6?: string

    gsiHash7?: string
    gsiSort7?: string

    gsiHash8?: string
    gsiSort8?: string

    gsiHash9?: string
    gsiSort9?: string

    gsiHash10?: string
    gsiSort10?: string

    gsiHash11?: string
    gsiSort11?: string
}
```

When we create and save an object, depending on the indexes defined for an object, we add values to some of the indexed properties

So for the following repo:

```typescript
const purchaseRepo = getRepository<PurchaseID, Purchase, 'getPurchasersOfItem' | 'latestPurchases' | 'location' | 'latestPurchasesByCountry'>({
    hashKeyFields: ['userId'],
    sortKeyFields: ['itemId', 'id'],
    objectName: 'Purchase',
    queries: {
        getPurchasersOfItem: {
            which: 0,
            hashKeyFields: ['itemId'],
            sortKeyFields: ['purchaseDate', 'userId']
        },
        latestPurchases: {
            sortKeyFields: ['purchaseDate', 'itemId'],
            which: 1
        },
        location: {
            which: 2,
            sortKeyFields: ['country', 'state', 'city', 'purchaseDate', 'itemId']
        },
        latestPurchasesByCountry: {
            which: 3,
            sortKeyFields: ['country', 'purchaseDate']
        }
    }
});
```

When we create an item like this

```typescript
purchaseRepo.create({
    id: '1234',
    purchaseDate: 1572481596741,
    city: 'provo',
    state: 'ut',
    country: 'usa',
    itemId: 'awesomecouch',
    userId: '1208493'
});
```


This is what is stored in dynamodb

```javascript
let json ={
    hashKey: 'Purchase#userId-1208493',
    sortKey: 'Purchase#itemId-awesomecouch#id-1234',
    data:
    {
        id: '1234',
        purchaseDate: 1572481596741,
        city: 'provo',
        state: 'ut',
        country: 'usa',
        itemId: 'awesomecouch',
        userId: '1208493'
    },
    objectType: 'Purchase',
    gsiHash0: "Purchase-getPurchasersOfItem#itemId-awesomecouch",
    gsiSort0: "getPurchasersOfItem#purchaseDate-1572481596741#userId-1208493",
    lsi1: 'latestPurchases#purchaseDate-1572481596741#itemId-awesomecouch',
    lsi2: 'location#country-usa#state-ut#city-provo#purchaseDate-1572481596741#itemId-awesomecouch',
    lsi3: 'latestPurchasesByCountry#country-usa#purchaseDate-1572481596741'
}
```

For a simpler repo with no indexes, none of the indexes would be defined

Repo:
```typescript

type UserId = {id: string}
type User = {name: string} & UserId;

const userRepo = getRepository<UserId, User>({
    hashKeyFields: ['id'],
    objectName: 'User',
});
```

After creating the following object
```typescript
userRepo.create({
        id: '1',
        name: 'jim'
})
```

The following is stored in dynamodb
```javascript
{ 
    data: {
        id: '1',
        name: 'jim'
    },
    objectType: 'User',
    hashKey: 'User#id-1'
}
```

