import * as path from 'path'

import * as fg from 'fast-glob'
import * as k8s from '@pulumi/kubernetes'

import { k8sProvider } from './cluster'
import { deploySourcegraphRoot, generatedBase } from './config'

const storageClass = new k8s.storage.v1.StorageClass(
    'sourcegraph-storage-class',
    {
        metadata: {
            name: 'sourcegraph',

            labels: {
                deploy: 'sourcegraph',
            },
        },
        provisioner: 'kubernetes.io/gce-pd',

        parameters: {
            type: 'pd-ssd',
        },
    },
    { provider: k8sProvider }
)

const nameSpace = new k8s.core.v1.Namespace(
    'sourcegraph-namespace',
    {
        metadata: {
            name: 'ns-sourcegraph',
        },
    },
    { provider: k8sProvider }
)

const globOptions = {
    ignore: ['**/kustomization.yaml'],
}

const baseFiles = fg(`${generatedBase}/**/*.yaml`, globOptions)
baseFiles.then(
    files =>
        new k8s.yaml.ConfigGroup(
            'base',
            {
                files,
            },
            {
                providers: { kubernetes: k8sProvider },
                dependsOn: [storageClass, nameSpace],
            }
        )
)
const ingressNginxFiles = fg(
    `${path.posix.join(deploySourcegraphRoot, 'configure', 'ingress-nginx')}/**/*.yaml`,
    globOptions
)

const ingressNginx = ingressNginxFiles.then(
    files =>
        new k8s.yaml.ConfigGroup(
            'ingress-nginx',
            {
                files,
            },
            { providers: { kubernetes: k8sProvider } }
        )
)

export const ingressIP = ingressNginx.then(ingress =>
    ingress
        .getResource('v1/Service', 'ingress-nginx', 'ingress-nginx')
        .apply(svc => svc && svc.status)
        .apply(status => (status && status.loadBalancer.ingress.map(i => i.ip)) || [])
        .apply(ips => (ips.length === 1 ? ips[0] : undefined))
)

export * from './cluster'
