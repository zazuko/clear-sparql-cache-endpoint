# Clear SPARQL cache endpoint

This assumes that your cached endpoint is using Varnish and has the `xkey` module enabled.
You can take a look at our custom [varnish-post](https://github.com/zazuko/varnish-post) repository that comes with all required configuration for the cached endpoint.

## Get started

```sh
npm install # Install dependencies
cp example.env .env # Copy environment variables file
# Open your editor, and fill the environment variables in the `.env` file
npm run start # Start the script
```

## Environment variables

| Name                          | Description                                                               | Default Value                  |
| ----------------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| **CACHE_ENDPOINT**            | The URL of the cache endpoint                                             | `""`                           |
| CACHE_ENDPOINT_USERNAME       | The username for the cache endpoint                                       | `""`                           |
| CACHE_ENDPOINT_PASSWORD       | The password for the cache endpoint                                       | `""`                           |
| CACHE_DEFAULT_ENTRY_NAME      | The default entry name for the cache                                      | `"default"`                    |
| CACHE_TAG_HEADER              | The header name for the cache tag                                         | `"xkey"`                       |
| SUPPORT_URL_ENCODED           | Whether to clear the cache for the URL-encoded version of the dataset URI | `"true"`                       |
| **SPARQL_ENDPOINT_URL**       | The URL of the SPARQL endpoint                                            | `""`                           |
| SPARQL_USERNAME               | The username for the SPARQL endpoint                                      | `""`                           |
| SPARQL_PASSWORD               | The password for the SPARQL endpoint                                      | `""`                           |
| S3_ENABLED                    | Whether to use S3 for caching                                             | `"false"`                      |
| S3_LAST_TIMESTAMP_KEY         | The key for the last timestamp file in S3                                 | `"last_timestamp.txt"`         |
| S3_SIMPLE_DATE_WORKAROUND_KEY | The key for the simple date workaround file in S3                         | `"simple_date_workaround.txt"` |
| S3_BUCKET                     | The S3 bucket name                                                        | `"default"`                    |
| S3_ACCESS_KEY_ID              | The S3 access key ID                                                      | `""`                           |
| S3_SECRET_ACCESS_KEY          | The S3 secret access key                                                  | `""`                           |
| S3_REGION                     | The S3 region                                                             | `"default"`                    |
| S3_ENDPOINT                   | The S3 endpoint                                                           | `""`                           |
| S3_SSL_ENABLED                | Whether to use SSL for S3                                                 | `"false"`                      |
| S3_FORCE_PATH_STYLE           | Whether to force path style for S3                                        | `"false"`                      |

If `S3_ENABLED` is set to `true`, the first time you run the script you might see an error message saying that the last timestamp file does not exist. This is expected, and the script will create the file automatically at the end of the first run, and will update that file every time it runs.
You will not see this error message again after the first run.

You might also get a similar error about a simple date workaround file. This is also expected, and the script will create the file automatically at the end of the first run, and will update that file every time it runs.

Using S3 allows us to trick a bit for the cases where `dateModified` returned by the SPARQL query is a `date` and not a `dateTime`.
The trick makes sure that the cache is invalidated for this entry only the first time, and the day after the `dateModified` date.
Without this trick, the cache would be invalidated every time the script runs until the day after its value.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
