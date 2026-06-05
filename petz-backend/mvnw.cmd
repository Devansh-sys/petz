@echo off
setlocal
set MAVEN_HOME=C:\The Maven 3.9.11\apache-maven-3.9.14-bin\apache-maven-3.9.14
set MVN_CMD=%MAVEN_HOME%\bin\mvn.cmd
if not exist "%MVN_CMD%" (
    echo [ERROR] Maven not found at %MAVEN_HOME%
    echo Please install Maven or update MAVEN_HOME in this file.
    exit /b 1
)
"%MVN_CMD%" %*
