# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json Directory.Build.props ./
COPY src/ShopMint.Api/ShopMint.Api.csproj src/ShopMint.Api/
RUN dotnet restore src/ShopMint.Api/ShopMint.Api.csproj
COPY src/ src/
RUN dotnet publish src/ShopMint.Api/ShopMint.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
# Run as the non-root user shipped in the official image.
USER $APP_UID
ENTRYPOINT ["dotnet", "ShopMint.Api.dll"]
