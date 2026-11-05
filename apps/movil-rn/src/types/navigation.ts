import type { IssuedCredential } from './models';

export type RootStackParamList = {
  Login: undefined;
  Operator: undefined;
  CameraMode: undefined;
  EdgeMode: undefined;
  CameraDetail: { deviceId: string };
  AddEdge: undefined;
  RelocateEdge: { deviceId: string };
  IssuedToken: { issued: IssuedCredential; command?: string; autonomous?: boolean };
};

export type TabParamList = {
  Cameras: undefined;
  Query: undefined;
  Results: undefined;
  History: undefined;
  Settings: undefined;
};
