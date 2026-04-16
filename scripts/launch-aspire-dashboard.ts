import { startAspireDashboard } from './aspireDashboard';

const dashboard = await startAspireDashboard();

console.log(
  `${dashboard.startedByScript ? 'Started' : 'Reusing'} Aspire Dashboard at ${dashboard.dashboardUrl}`,
);
console.log(`OTLP/gRPC receiver: ${dashboard.otlpGrpcEndpoint}`);
console.log(`OTLP/HTTP receiver: ${dashboard.otlpHttpEndpoint}`);
