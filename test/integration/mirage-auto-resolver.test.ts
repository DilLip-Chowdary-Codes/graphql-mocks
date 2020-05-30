/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect } from 'chai';
import defaultResolvers from './test-helpers/mirage-static-resolvers';
import { patchModelTypes } from '../../src/mirage/middleware/patch-model-types';
import { patchUnionsInterfaces } from '../../src/mirage/middleware/patch-auto-unions-interfaces';
import { server as mirageServer } from './test-helpers/mirage-sample';
import defaultScenario from './test-helpers/mirage-sample/scenarios/default';
import { graphqlSchema } from './test-helpers/test-schema';
import { MirageGraphQLMapper } from '../../src/mirage/mapper';
import { ResolverMap } from '../../src/types';
import { createQueryHandler } from '../../src/graphql';

describe('integration/mirage-auto-resolver', function () {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let graphQLHandler: any;
  let resolvers: ResolverMap;
  let mapper: MirageGraphQLMapper;

  this.beforeEach(() => {
    mapper = new MirageGraphQLMapper()
      .add(['AthleticHobby'], ['SportsHobby'])
      .add(['Automobile'], ['Car'])
      .add(['Person', 'paginatedFriends'], ['Person', 'friends'])
      .add(['Person', 'fullName'], ['Person', 'name']);

    mirageServer.db.loadData(defaultScenario);
    const middlewares = [patchModelTypes, patchUnionsInterfaces];
    const handler = createQueryHandler(defaultResolvers, {
      state: {},
      middlewares,
      dependencies: {
        mapper,
        mirageServer,
        graphqlSchema: graphqlSchema,
      },
    });

    graphQLHandler = handler.query;
  });

  this.afterEach(() => {
    mirageServer.db.emptyData();
    (resolvers as unknown) = undefined;
    graphQLHandler = undefined;
  });

  it('can handle a type look up', async function () {
    const query = `query {
      person(id: 1) {
        id
        name
        posts {
          body
        }
      }
    }`;

    const result = await graphQLHandler(query);
    expect(result).to.deep.equal({
      data: {
        person: {
          id: '1',
          name: 'Fred Flinstone',
          posts: [
            {
              body:
                "They're the modern stone age family. From the town of Bedrock. They're a page right out of history",
            },
          ],
        },
      },
    });
  });

  it('can handle a type look up using a mapper', async function () {
    const query = `query {
      person(id: 1) {
        id
        name
        fullName
      }
    }`;

    const modelAttrs = mirageServer.schema.first('person')!.attrs;
    expect('name' in modelAttrs).to.be.true;
    expect('fullName' in modelAttrs).to.be.false;
    expect(
      mapper.mappings.find(
        ({ graphql: [type, field], mirage: [model, attr] }) =>
          type === 'Person' && field === 'fullName' && model === 'Person' && attr === 'name',
      ),
    ).to.not.equal(undefined);

    const result = await graphQLHandler(query);
    expect(result).to.deep.equal({
      data: {
        person: {
          id: '1',
          name: 'Fred Flinstone',
          fullName: 'Fred Flinstone',
        },
      },
    });
  });

  // Person
  //   has Posts
  //     (author should match the Person)
  //     has Comments
  //       (comment author could be different than the Person who wrote the post)
  //
  // the resolver should be able to handle lookups for a Person whether the parent
  // is an author of a post or an author of a nested comment

  it('can handle a first generation parent type (person in posts.author)', async function () {
    const query = `query {
      person(id: 1) {
        id
        name
        posts {
          author {
            id
            name
          }
        }
      }
    }`;

    const result = await graphQLHandler(query);

    expect(result.data!.person.id).to.equal(result.data!.person.posts[0].author.id);
    expect(result.data!.person.name).to.equal(result.data!.person.posts[0].author.name);
  });

  it('can handle a second generation parent type (person in posts.comments.author)', async function () {
    const query = `query {
      person(id: 1) {
        id
        name
        posts {
          comments {
            body
            author {
              name
            }
          }
        }
      }
    }`;

    const result = await graphQLHandler(query);
    expect(result.data!.person.posts[0].comments[0].body).to.equal('I love the town of Bedrock!');
    expect(result.data!.person.posts[0].comments[0].author.name).to.equal('Barney Rubble');
  });

  it('can resolve a union type', async function () {
    const query = `query {
      allPersons {
        id
        name

        transportation {
          __typename

          ... on Bicycle {
            brand
          }

          ... on Automobile {
            make
            model
          }

          ... on PublicTransit {
            primary
          }
        }
      }
    }`;

    const result = await graphQLHandler(query);
    const [fred, barnie, wilma] = result.data!.allPersons;

    expect(fred.name).to.equal('Fred Flinstone');
    expect(fred.transportation.__typename).to.equal('Bicycle');
    expect(fred.transportation.brand).to.equal('Bianchi');

    expect(barnie.name).to.equal('Barney Rubble');
    expect(barnie.transportation.__typename).to.equal('PublicTransit');
    expect(barnie.transportation.primary).to.equal('Subway');

    expect(wilma.name).to.equal('Wilma Flinstone');
    expect(wilma.transportation.__typename).to.equal('Automobile');
    expect(wilma.transportation.make).to.equal('Volkwagen');
    expect(wilma.transportation.model).to.equal('Golf');
  });

  it('can resolve an interface type', async function () {
    // This test handles a few different auto-resolving cases.
    // Case #1. parent mirage model name, look up on mapper
    // Case #2. parent mirage model name, looked up as GraphQL Type
    // Case #3. Looking at all types that use the interface and find a type
    // that shares the most common fields

    // Case #1 pre-checks
    expect(graphqlSchema.getType('SportsHobby')).to.equal(undefined, 'SportsHobby does not exist on schema');
    expect(mirageServer.schema.all('SportsHobby').length).to.be.greaterThan(
      0,
      'SportsHobby does exist as model on mirage',
    );
    expect(graphqlSchema.getType('AthleticHobby')).to.not.equal(undefined, 'AthleticHobby does exist on the schema');
    expect(() => mirageServer.schema.all('AthleticHobby')).to.throw(
      `Mirage: You're trying to find model(s) of type AthleticHobby but this collection doesn't exist in the database`,
      'AthleticHobby does exist as a mirage model',
    );
    expect(
      mapper.mappings.some((mapping) => {
        return mapping.graphql[0] === 'AthleticHobby' && mapping.mirage[0] === 'SportsHobby';
      }),
    ).to.be.equal(true, 'mapping exists betwene mirage and graphql');

    // Case #3 pre-checks
    expect(graphqlSchema.getType('CulinaryHobby')).to.equal(undefined, 'CulinaryHobby does not exist on schema');
    expect(mirageServer.schema.all('CulinaryHobby').length).to.be.greaterThan(
      0,
      'CulinaryHobby does exist as model on mirage',
    );
    expect(graphqlSchema.getType('CookingHobby')).to.not.equal(undefined, 'CookingHobby does exist on the schema');
    expect(() => mirageServer.schema.all('CookingHobby')).to.throw(
      `Mirage: You're trying to find model(s) of type CookingHobby but this collection doesn't exist in the database`,
      'CookingHobby does exist as a mirage model',
    );
    expect(
      mapper.mappings.some((mapping) => {
        return mapping.graphql[0] === 'CookingHobby' && mapping.mirage[0] === 'CulinaryHobby';
      }),
    ).to.be.equal(false, 'no mappings exists betwene mirage and graphql');

    const query = `query {
      allPersons {
        id
        name

        hobbies {
          __typename

          name
          requiresEquipment

          ... on AthleticHobby {
            hasMultiplePlayers
          }

          ... on CookingHobby {
            requiresOven
            requiresStove
          }

          ... on MakerHobby {
            makerType
          }
        }
      }
    }`;

    const result = await graphQLHandler(query);
    const [firstPerson, secondPerson] = result.data!.allPersons;

    expect(firstPerson.name).to.equal('Fred Flinstone');
    expect(firstPerson.hobbies).to.deep.equal([
      {
        __typename: 'CookingHobby',
        name: 'Cooking',
        requiresEquipment: true,
        requiresOven: false,
        requiresStove: true,
      },
      {
        __typename: 'CookingHobby',
        name: 'Baking',
        requiresEquipment: true,
        requiresOven: true,
        requiresStove: false,
      },
      {
        __typename: 'AthleticHobby',
        hasMultiplePlayers: false,
        name: 'Running',
        requiresEquipment: false,
      },
    ]);

    expect(secondPerson.name).to.equal('Barney Rubble');
    expect(secondPerson.hobbies).to.deep.equal([
      {
        __typename: 'MakerHobby',
        makerType: 'Textile',
        name: 'Knitting',
        requiresEquipment: true,
      },
      {
        __typename: 'AthleticHobby',
        hasMultiplePlayers: true,
        name: 'Soccer',
        requiresEquipment: true,
      },
    ]);
  });

  it('can resolve an enum type', async function () {
    const query = `query {
      allPersons {
        id
        name
        favoriteColor
      }
    }`;

    const result = await graphQLHandler(query);
    const [firstPerson, secondPerson] = result.data!.allPersons;

    expect(firstPerson.name).to.equal('Fred Flinstone');
    expect(firstPerson.favoriteColor).to.equal('Yellow');

    expect(secondPerson.name).to.equal('Barney Rubble');
    expect(secondPerson.favoriteColor).to.equal('Green');
  });

  it('can resolve a list type', async function () {
    const query = `query {
      allPersons {
        name
        hobbies {
          name
        }
      }
    }`;

    const result = await graphQLHandler(query);
    const [firstPerson, secondPerson] = result.data!.allPersons;

    expect(firstPerson.name).to.equal('Fred Flinstone');
    expect(firstPerson.hobbies).to.deep.equal([
      {
        name: 'Cooking',
      },
      {
        name: 'Baking',
      },
      {
        name: 'Running',
      },
    ]);

    expect(secondPerson.name).to.equal('Barney Rubble');
    expect(secondPerson.hobbies).to.deep.equal([
      {
        name: 'Knitting',
      },
      {
        name: 'Soccer',
      },
    ]);
  });

  it('can resolve non-null types', async () => {
    const query = `query {
      allPersons {
        name
        favoriteColor
      }
    }`;

    const result = await graphQLHandler(query);
    const [fred, barney, wilma] = result.data.allPersons;

    expect(fred).to.deep.equal({
      name: 'Fred Flinstone',
      favoriteColor: 'Yellow',
    });
    expect(barney).to.deep.equal({
      name: 'Barney Rubble',
      favoriteColor: 'Green',
    });
    expect(wilma).to.deep.equal({
      name: 'Wilma Flinstone',
      favoriteColor: 'Red',
    });
  });

  it('can resolve null types', async () => {
    const query = `query {
      allPersons {
        name
        leastFavoriteColor
      }
    }`;

    const result = await graphQLHandler(query);
    const [fred, barney, wilma] = result.data.allPersons;

    expect(fred).to.deep.equal({
      name: 'Fred Flinstone',
      leastFavoriteColor: 'Blue',
    });
    expect(barney).to.deep.equal({
      name: 'Barney Rubble',
      leastFavoriteColor: null,
    });
    expect(wilma).to.deep.equal({
      name: 'Wilma Flinstone',
      leastFavoriteColor: null,
    });
  });

  describe('Relay Connections', () => {
    it('can resolve a root-level relay connection (via static resolver with helpers)', async () => {
      const query = `query {
        allPersonsPaginated(first: 2) {
          edges {
            cursor
            node {
              id
              name
            }
          }
          pageInfo {
            endCursor
            hasNextPage
            hasPreviousPage
            startCursor
          }
        }
      }`;

      const result = await graphQLHandler(query);
      console.log(result.errors);
      expect(result.errors).to.equal(undefined);

      const edges = result.data.allPersonsPaginated.edges;
      const pageInfo = result.data.allPersonsPaginated.pageInfo;
      const firstPersonEdge = edges[0];
      const secondPersonEdge = edges[1];

      expect(firstPersonEdge.cursor).to.equal('model:person(1)');
      expect(firstPersonEdge.node.id).to.equal('1');
      expect(firstPersonEdge.node.name).to.equal('Fred Flinstone');

      expect(secondPersonEdge.cursor).to.equal('model:person(2)');
      expect(secondPersonEdge.node.id).to.equal('2');
      expect(secondPersonEdge.node.name).to.equal('Barney Rubble');

      expect(pageInfo).to.deep.equal({
        endCursor: 'model:person(2)',
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: 'model:person(1)',
      });
    });

    it('can resolve a type relay connection', async () => {
      const query = `query {
        allPersons {
          id
          name
          paginatedFriends(first: 1) {
            edges {
              cursor
              node {
                name
              }
            }
            pageInfo {
              startCursor
              endCursor
              hasPreviousPage
              hasNextPage
            }
          }
        }
      }`;

      const result = await graphQLHandler(query);
      const firstPerson = result.data.allPersons[0];

      expect(firstPerson.name).to.equal('Fred Flinstone');
      expect(firstPerson.id).to.equal('1');
      expect(firstPerson.paginatedFriends.edges.length).to.equal(1);
      expect(firstPerson.paginatedFriends.edges[0].cursor).to.equal('model:person(2)');
      expect(firstPerson.paginatedFriends.edges[0].node.name).to.equal('Barney Rubble');
      expect(firstPerson.paginatedFriends.pageInfo).to.deep.equal({
        endCursor: 'model:person(2)',
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: 'model:person(2)',
      });
    });
  });
});