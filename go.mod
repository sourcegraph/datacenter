module github.com/sourcegraph/deploy-sourcegraph

go 1.16

require (
	github.com/docker/docker v1.13.1 // indirect
	github.com/pulumi/pulumi v1.12.0
	github.com/sethgrid/pester v1.1.0
	github.com/slimsag/update-docker-tags v0.7.0
	github.com/sourcegraph/sourcegraph/enterprise/dev/ci/images v0.0.0-20210719134048-8bbd7718dcd9
	golang.org/x/crypto v0.0.0-20191011191535-87dc89f01550 // indirect
	golang.org/x/xerrors v0.0.0-20191011141410-1b5146add898 // indirect
)

replace github.com/Azure/go-autorest/v14 => github.com/Azure/go-autorest v14.2.0
