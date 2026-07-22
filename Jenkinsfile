pipeline {
    agent any

    triggers {
        pollSCM('* * * * *')
    }

    environment {
        IMAGE = "ghcr.io/prem7443/multi-auth-api"

        DEPLOY_HOST = "100.48.135.152"
        DEPLOY_USER = "ubuntu"

        SECRET_ID = "apps/multi-auth/config"
        AWS_REGION = "us-east-1"

        CONTAINER_NAME = "multi-auth-api"
        APP_PORT = "5000"

        LASTGOOD_FILE = "/opt/apps/multi-auth.lastgood"

        HEALTH_URL = "http://localhost:5000/health"
        HEALTH_RETRIES = "5"
        HEALTH_DELAY = "3"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm

                script {
                    env.VERSION = "v${env.BUILD_NUMBER}"
                    env.IMAGE_TAG = "${IMAGE}:${env.VERSION}"
                }

                echo "Building version ${env.IMAGE_TAG}"
            }
        }

        stage('Test') {
            steps {
                sh '''
                docker run --rm \
                    -v "$WORKSPACE":/app \
                    -w /app \
                    node:20-slim \
                    sh -c "npm install"
                '''
            }
        }

        stage('Build Image') {
            steps {
                sh '''
                docker build \
                  -t "$IMAGE_TAG" \
                  -t "$IMAGE:latest" .
                '''
            }
        }

        stage('Push Image') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'ghcr-creds',
                        usernameVariable: 'GHCR_USER',
                        passwordVariable: 'GHCR_PAT'
                    )
                ]) {
                    sh '''
                    echo "$GHCR_PAT" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

                    docker push "$IMAGE_TAG"
                    docker push "$IMAGE:latest"
                    '''
                }
            }
        }

        stage('Run Prisma Migration') {
            steps {
                sshagent(credentials: ['deploy-ssh-key']) {
                    sh """
                    cat << 'CMD_EOF' | base64 -w 0 | ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'base64 -d | bash'
set -e
RAW_SECRET=\$(aws secretsmanager get-secret-value --secret-id ${SECRET_ID} --region ${AWS_REGION} --query SecretString --output text)
DB_URL=\$(echo "\$RAW_SECRET" | jq -r .DATABASE_URL)

docker pull ${IMAGE_TAG}
docker run --rm -e DATABASE_URL="\$DB_URL" ${IMAGE_TAG} npx prisma migrate deploy
CMD_EOF
                    """
                }
            }
        }

        stage('Deploy with Docker Compose') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'ghcr-creds',
                        usernameVariable: 'GHCR_USER',
                        passwordVariable: 'GHCR_PAT'
                    )
                ]) {
                    sshagent(credentials: ['deploy-ssh-key']) {
                        // Ensure remote dir exists, then push docker-compose.yml
                        // from the Jenkins workspace to the deploy host.
                        sh """
                        ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'mkdir -p /opt/apps/multi-auth'
                        scp -o StrictHostKeyChecking=no docker-compose.yml ${DEPLOY_USER}@${DEPLOY_HOST}:/opt/apps/multi-auth/docker-compose.yml
                        """

                        sh """
                        cat << 'CMD_EOF' | base64 -w 0 | ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'base64 -d | bash'
set -e
cd /opt/apps/multi-auth

RAW_SECRET=\$(aws secretsmanager get-secret-value --secret-id ${SECRET_ID} --region ${AWS_REGION} --query SecretString --output text)

# Escape literal newlines inside values (e.g. PEM keys) as \\n so each
# KEY=VALUE stays on a single line in .env
echo "\$RAW_SECRET" | jq -r 'to_entries[] | "\\(.key)=\\(.value | tostring | gsub("\\n"; "\\\\n"))"' > .env

sed -i "s|image: ${IMAGE}:.*|image: ${IMAGE_TAG}|g" docker-compose.yml

echo "${GHCR_PAT}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
docker compose pull multi-auth
docker compose up -d
CMD_EOF
                        """
                    }
                }
            }
        }

        stage('Health Check') {
            steps {
                sshagent(credentials: ['deploy-ssh-key']) {
                    script {
                        def healthy = false

                        for (int i = 0; i < env.HEALTH_RETRIES.toInteger(); i++) {

                            def status = sh(
                                script: """
                                ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} \
                                "curl -s -o /dev/null -w '%{http_code}' ${HEALTH_URL}" || true
                                """,
                                returnStdout: true
                            ).trim()

                            if (status == "200") {
                                healthy = true
                                break
                            }

                            sleep(env.HEALTH_DELAY.toInteger())
                        }

                        if (!healthy) {
                            error("Health check failed for multi-auth service.")
                        }
                    }
                }
            }
        }

        stage('Save Last Good Version') {
            steps {
                sshagent(credentials: ['deploy-ssh-key']) {
                    sh """
                    cat << 'CMD_EOF' | base64 -w 0 | ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'base64 -d | bash'
mkdir -p /opt/apps
echo "${VERSION}" > ${LASTGOOD_FILE}
CMD_EOF
                    """
                }
            }
        }
    }

    post {
        failure {
            echo "Deployment failed. Attempting rollback..."

            catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
                sshagent(credentials: ['deploy-ssh-key']) {
                    sh """
                    cat << 'CMD_EOF' | base64 -w 0 | ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'base64 -d | bash'
set -e
if [ -s "${LASTGOOD_FILE}" ]; then
    LAST_GOOD=\$(cat "${LASTGOOD_FILE}" | tr -d " \t\n\r")

    if [ -n "\$LAST_GOOD" ]; then
        echo "Rolling back multi-auth to version: \$LAST_GOOD"
        cd /opt/apps/multi-auth
        sed -i "s|image: ${IMAGE}:.*|image: ${IMAGE}:\$LAST_GOOD|g" docker-compose.yml
        docker compose pull multi-auth
        docker compose up -d multi-auth
    else
        echo "Rollback file is empty. Skipping rollback."
    fi
else
    echo "No rollback version recorded."
fi
CMD_EOF
                    """
                }
            }
        }

        success {
            echo "Successfully deployed multi-auth API version: ${env.VERSION}"
        }
    }
}
