# Clear SPARQL cache endpoint

This assumes that your cached endpoint is using Varnish and has the `xkey` module enabled.
You can take a look at our custom [varnish-post](https://github.com/zazuko/varnish-post) repository that comes with all required configuration for the cached endpoint.

## Get started

```sh
npm install # Install dependencies
cp .env.example .env # Copy environment variables
# Open your editor, and fill the environment variables in the `.env` file
npm run start # Start the script
```

## Environment variables

| Name                     | Description                                                               | Default Value |
| ------------------------ | ------------------------------------------------------------------------- | ------------- |
| **CACHE_ENDPOINT**       | The URL of the cache endpoint                                             | `""`          |
| CACHE_ENDPOINT_USERNAME  | The username for the cache endpoint                                       | `""`          |
| CACHE_ENDPOINT_PASSWORD  | The password for the cache endpoint                                       | `""`          |
| CACHE_DEFAULT_ENTRY_NAME | The default entry name for the cache                                      | `"default"`   |
| CACHE_TAG_HEADER         | The header name for the cache tag                                         | `"xkey"`      |
| SUPPORT_URL_ENCODED      | Whether to clear the cache for the URL-encoded version of the dataset URI | `"true"`      |
| **SPARQL_ENDPOINT_URL**  | The URL of the SPARQL endpoint                                            | `""`          |
| SPARQL_USERNAME          | The username for the SPARQL endpoint                                      | `""`          |
| SPARQL_PASSWORD          | The password for the SPARQL endpoint                                      | `""`          |

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
