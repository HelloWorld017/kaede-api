using Workerd = import "/workerd/workerd.capnp";

const passwordConfig :Workerd.Config = (
  services = [
    (
      name = "genpassword",
      worker = (
        compatibilityDate = "2026-10-25",
        modules = [(name = "password.bundle.js", esModule = embed "/password.bundle.js")],
        bindings = [(name = "PASSWORD", fromEnvironment = "PASSWORD")]
      )
    )
  ]
);

const config :Workerd.Config = (
  services = [
    (
      name = "main",
      worker = (
        compatibilityDate = "2026-10-25",
        modules = [(name = "backend.bundle.js", esModule = embed "/backend.bundle.js")],
        bindings = [
          (name = "STORAGE", durableObjectNamespace = (className = "AppStorage")),
          (name = "GHOST_URL", fromEnvironment = "GHOST_URL"),
          (name = "GHOST_KEY", fromEnvironment = "GHOST_KEY"),
          (name = "CORS_ORIGIN", fromEnvironment = "CORS_ORIGIN"),
          (name = "ADMIN_PASSWORD", fromEnvironment = "ADMIN_PASSWORD"),
          (name = "COMMENTS_MAX_COUNT", fromEnvironment = "COMMENTS_MAX_COUNT"),
          (name = "COMMENTS_MAX_AUTHOR", fromEnvironment = "COMMENTS_MAX_AUTHOR"),
          (name = "COMMENTS_MAX_CONTENT", fromEnvironment = "COMMENTS_MAX_CONTENT")
        ],
        durableObjectNamespaces = [
          (className = "AppStorage", uniqueKey = "kaede-api-storage-v2", enableSql = true)
        ],
        durableObjectStorage = (localDisk = "do-storage")
      )
    ),
    (name = "do-storage", disk = (writable = true)),
    (
      name = "internet",
      network = (allow = ["public", "private"], tlsOptions = (trustBrowserCas = true))
    )
  ],
  sockets = [(name = "http", address = "*:11005", http = (), service = "main")]
);
