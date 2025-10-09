import { useState, useContext } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { UserContext } from "../../lib/context";
import { HStack, Button, Text, Tooltip } from "@chakra-ui/react";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { db } from "../../lib/firebase";
import { CheckCircleIcon, WarningIcon } from "@chakra-ui/icons";

export default function GoogleDriveToken() {
  const { user } = useContext(UserContext);
  const [data] = useDocumentData(doc(db, "users", user.uid));

  // Parámetros de Google OAuth
  const CLIENT_ID =
    "414213417080-bgjk8udcblfgrdld33eif0cmtofl7kir.apps.googleusercontent.com";
  const REDIRECT_URI = "http://localhost:3000/google-drive-callback"; // Debe coincidir con el backend y Google Console
  // const REDIRECT_URI = "https://test-e4cf9.firebaseapp.com/google-drive-callback"; // Producción

  const RESPONSE_TYPE = "code";
  // Scopes de Google Drive - usar scope completo para crear carpetas
  const SCOPE =
    "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email";

  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=${RESPONSE_TYPE}&scope=${encodeURIComponent(
    SCOPE
  )}&access_type=offline&prompt=consent&state=${user?.uid}`;

  // Función para borrar el token de Google Drive
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDeleteToken = async () => {
    setIsDeleting(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        googleDriveTokens: null,
      });
    } catch (err) {
      console.error("Error deleting Google Drive token:", err);
    }
    setIsDeleting(false);
  };

  return (
    <HStack justifyContent="space-between" w="100%">
      <HStack>
        <Text fontSize={"lg"}>Google Drive Token</Text>
        {data && data.googleDriveTokens ? (
          <Tooltip label="Valid Google Drive Token">
            <CheckCircleIcon color="brandTeal.500" />
          </Tooltip>
        ) : (
          <Tooltip label="No válido o no conectado">
            <WarningIcon color="brandOrange.500" />
          </Tooltip>
        )}
      </HStack>
      {data && data.googleDriveTokens ? (
        <Button
          colorScheme="red"
          isLoading={isDeleting}
          onClick={handleDeleteToken}
        >
          Desconectar Google Drive
        </Button>
      ) : (
        <Button
          as="a"
          href={oauthUrl}
          colorScheme="brandTeal"
          target="_blank"
          rel="noopener noreferrer"
        >
          Conectar Google Drive
        </Button>
      )}
    </HStack>
  );
}
