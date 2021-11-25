import { resolve, join } from "path"
import { readFile } from "fs/promises"
import axios from "axios"
import { DgraphAdapter, DgraphClientParams, format } from "../src"
import { client as dgraphClient, DgraphJwtAlgorithm } from "../src/client"
import { runBasicTests } from "../../../basic-tests"
import {
  Account,
  Session,
  User,
  VerificationToken,
} from "../src/graphql/fragments"

const readSchema = async (
  jwtAlgorithm?: DgraphJwtAlgorithm
): Promise<string> => {
  const path = resolve(
    process.cwd(),
    join(
      "./src/graphql",
      jwtAlgorithm ? `test${jwtAlgorithm}.schema.gql` : "unsecure.schema.gql"
    )
  )
  return await readFile(path, { encoding: "utf-8" })
}

const loadSchema = async (
  jwtAlgorithm?: DgraphJwtAlgorithm,
  endpoint?: string
): Promise<boolean> => {
  try {
    const res = await axios(
      endpoint
        ? endpoint.replace("graphql", "admin/schema")
        : "http://localhost:8080/admin/schema",
      {
        method: "POST",
        data: await readSchema(jwtAlgorithm),
      }
    )
    return res.status === 200
  } catch (err) {
    console.log(err)
    return false
  }
}

function testDgraph(clientParams: {
  endpoint?: string
  jwtAlgorithm?: DgraphJwtAlgorithm
  jwtSecret?: string
}) {
  describe(
    clientParams.jwtAlgorithm
      ? `secure ${clientParams.jwtAlgorithm}`
      : "unsecure",
    () => {
      beforeAll(async () => {
        await loadSchema(clientParams.jwtAlgorithm, clientParams.endpoint)
      })
      const params: DgraphClientParams = {
        endpoint: "http://localhost:8080/graphql",
        authToken: "test",
        ...clientParams,
      }

      /** TODO: Add test to `dgraphClient` */
      const c = dgraphClient(params)

      runBasicTests({
        adapter: DgraphAdapter(params),
        db: {
          id: () => "0x0a0a00a00",
          async disconnect() {
            await c.run(/* GraphQL */ `
              mutation {
                deleteUser(filter: {}) {
                  numUids
                }
                deleteVerificationToken(filter: {}) {
                  numUids
                }
                deleteSession(filter: {}) {
                  numUids
                }
                deleteAccount(filter: {}) {
                  numUids
                }
              }
            `)
          },
          async user(id) {
            const result = await c.run<any>(
              /* GraphQL */ `
                query ($id: ID!) {
                  getUser(id: $id) {
                    ...UserFragment
                  }
                }
                ${User}
              `,
              { id }
            )

            return format.from(result)
          },
          async session(sessionToken) {
            const result = await c.run<any>(
              /* GraphQL */ `
                query ($sessionToken: String!) {
                  querySession(
                    filter: { sessionToken: { eq: $sessionToken } }
                  ) {
                    ...SessionFragment
                    user {
                      id
                    }
                  }
                }
                ${Session}
              `,
              { sessionToken }
            )

            const { user, ...session } = result?.[0] ?? {}
            if (!user?.id) return null
            return format.from({ ...session, userId: user.id })
          },
          async account(provider_providerAccountId) {
            const result = await c.run<any>(
              /* GraphQL */ `
                query (
                  $providerAccountId: String = ""
                  $provider: String = ""
                ) {
                  queryAccount(
                    filter: {
                      providerAccountId: { eq: $providerAccountId }
                      provider: { eq: $provider }
                    }
                  ) {
                    ...AccountFragment
                    user {
                      id
                    }
                  }
                }
                ${Account}
              `,
              provider_providerAccountId
            )

            const account = format.from<any>(result?.[0])
            if (!account?.user) return null

            account.userId = account.user.id
            delete account.user
            return account
          },
          async verificationToken(identifier_token) {
            const result = await c.run<any>(
              /* GraphQL */ `
                query ($identifier: String = "", $token: String = "") {
                  queryVerificationToken(
                    filter: {
                      identifier: { eq: $identifier }
                      token: { eq: $token }
                    }
                  ) {
                    ...VerificationTokenFragment
                  }
                }
                ${VerificationToken}
              `,
              identifier_token
            )

            return format.from(result?.[0])
          },
        },
      })
    }
  )
}

describe("DgraphAdapter", () => {
  const testCases: Array<{
    endpoint?: string
    jwtSecret?: string
    jwtAlgorithm?: DgraphJwtAlgorithm
  }> = [
    {
      endpoint: "http://localhost:8080/graphql",
    },
    {
      endpoint: "http://localhost:8081/graphql",
      jwtAlgorithm: "HS256",
      jwtSecret: process.env.DGRAPH_JWT_SECRET_HS256,
    },
    {
      endpoint: "http://localhost:8082/graphql",
      jwtAlgorithm: "RS256",
      jwtSecret: process.env.DGRAPH_JWT_SECRET_RS256?.replace(/\\n/g, "\n"),
    },
  ]

  testCases.map(testDgraph)
})
