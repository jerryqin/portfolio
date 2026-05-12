import React from 'react';
import { StatusBar } from 'react-native';
import { RealmProvider } from '@realm/react';

import { RealmSchema, REALM_SCHEMA_VERSION } from './src/database/schema';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0F" />
      <RealmProvider
        schema={RealmSchema}
        schemaVersion={REALM_SCHEMA_VERSION}>
        <AppNavigator />
      </RealmProvider>
    </>
  );
}
