#!/usr/bin/env bash

set -ex

CLUSTER_NAME_SUFFIX=`echo ${BUILD_UUID} | head -c 8`

CLUSTER_NAME="ds-test-restricted-${CLUSTER_NAME_SUFFIX}"

cd $(dirname "${BASH_SOURCE[0]}")

CURRENT_DIR=$(pwd)
DEPLOY_SOURCEGRAPH_ROOT=${CURRENT_DIR}/../../..

# set up the cluster, set up the fake user and restricted policy and then deploy the non-privileged overlay as that user

gcloud container clusters create ${CLUSTER_NAME} --zone ${TEST_GCP_ZONE} --num-nodes 3 --machine-type n1-standard-16 --disk-type pd-ssd --project ${TEST_GCP_PROJECT} --labels=cost-category=build,build-creator=${BUILD_CREATOR},build-branch=${BUILD_BRANCH},integration-test=fresh

gcloud container clusters get-credentials ${CLUSTER_NAME} --zone ${TEST_GCP_ZONE} --project ${TEST_GCP_PROJECT}

kubectl create clusterrolebinding cluster-admin-binding --clusterrole cluster-admin --user ${TEST_GCP_USERNAME}

kubectl apply -f sourcegraph.StorageClass.yaml

kubectl apply -f nonroot-policy.yaml

kubectl create namespace ns-sourcegraph

kubectl create serviceaccount -n ns-sourcegraph fake-user

kubectl create rolebinding -n ns-sourcegraph fake-admin --clusterrole=admin --serviceaccount=ns-sourcegraph:fake-user

kubectl create role -n ns-sourcegraph nonroot:unprivileged --verb=use --resource=podsecuritypolicy --resource-name=nonroot-policy

kubectl create rolebinding -n ns-sourcegraph fake-user:nonroot:unprivileged --role=nonroot:unprivileged --serviceaccount=ns-sourcegraph:fake-user

mkdir generated-cluster
CLEANUP="rm -rf generated-cluster; $CLEANUP"
"${DEPLOY_SOURCEGRAPH_ROOT}"/overlay-generate-cluster.sh non-privileged-create-cluster ${CURRENT_DIR}/generated-cluster

kubectl --as=system:serviceaccount:ns-sourcegraph:fake-user -n ns-sourcegraph apply -f ${CURRENT_DIR}/generated-cluster --recursive

kubectl  -n ns-sourcegraph expose deployment sourcegraph-frontend --type=NodePort --name sourcegraph --type=LoadBalancer

# wait for it all to finish (we list out the ones with persistent volume claim because they take longer)

kubectl -n ns-sourcegraph rollout status -w statefulset/indexed-search
kubectl -n ns-sourcegraph rollout status -w deployment/lsif-server
kubectl -n ns-sourcegraph rollout status -w deployment/prometheus
kubectl -n ns-sourcegraph rollout status -w deployment/redis-cache
kubectl -n ns-sourcegraph rollout status -w deployment/redis-store
kubectl -n ns-sourcegraph rollout status -w statefulset/gitserver
kubectl -n ns-sourcegraph rollout status -w deployment/sourcegraph-frontend

# hit it with one request

SOURCEGRAPH_IP=`kubectl -n ns-sourcegraph describe service sourcegraph | grep "LoadBalancer Ingress:" | cut -d ":" -f 2 | tr -d " "`

curl -m 60 http://${SOURCEGRAPH_IP}:3080

# delete cluster

gcloud container clusters delete ${CLUSTER_NAME} --zone ${TEST_GCP_ZONE} --project ${TEST_GCP_PROJECT} --quiet

