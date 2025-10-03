import { useState, useContext } from "react";
import { UserContext } from "../../lib/context";
import { HStack, Button, Text, Tooltip } from "@chakra-ui/react";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { CheckCircleIcon, WarningIcon } from "@chakra-ui/icons";

export default function DriveToken() {
  const { user } = useContext(UserContext);
  const [data] = useDocumentData(doc(db, "users", user.uid));

  // Parámetros de Google OAuth
  const CLIENT_ID =
    "414213417080-bgjk8udcblfgrdld33eif0cmtofl7kir.apps.googleusercontent.com";
  const REDIRECT_URI = "https://test-e4cf9.firebaseapp.com/__/auth/handler"; // Debe coincidir con el backend y Google Console
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const RESPONSE_TYPE = "code";
  // El UID se pasa como parámetro para asociar el token al usuario
  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=${RESPONSE_TYPE}&scope=${encodeURIComponent(
    SCOPE
  )}&access_type=offline&prompt=consent&uid=${user?.uid}`;

  return (
    <HStack justifyContent="space-between" w="100%">
      <HStack>
        <Text fontSize={"lg"}>Google Drive Token</Text>
        {data && data.driveTokenValid ? (
          <Tooltip label="Valid Drive Token">
            <CheckCircleIcon color="brandTeal.500" />
          </Tooltip>
        ) : (
          <Tooltip label="No válido o no conectado">
            <WarningIcon color="brandOrange.500" />
          </Tooltip>
        )}
      </HStack>
      <Button
        as="a"
        href={oauthUrl}
        colorScheme="brandTeal"
        target="_blank"
        rel="noopener noreferrer"
      >
        Conectar Google Drive
      </Button>
    </HStack>
  );
}
