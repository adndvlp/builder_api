import { useState, useContext } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { UserContext } from "../../lib/context";
import { HStack, Button, Text, Tooltip } from "@chakra-ui/react";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { db } from "../../lib/firebase";
import { CheckCircleIcon, WarningIcon } from "@chakra-ui/icons";

export default function DropboxToken() {
  const { user } = useContext(UserContext);
  const [data] = useDocumentData(doc(db, "users", user.uid));

  // Parámetros de Dropbox OAuth
  const CLIENT_ID = "pn9j0lbuvbmu3wl";
  //   const REDIRECT_URI = "https://test-e4cf9.firebaseapp.com/dropbox-callback"; // Debe coincidir con el backend y Dropbox Console
  const REDIRECT_URI = "http://localhost:3000/dropbox-callback"; // Debe coincidir con el backend y Dropbox Console

  const RESPONSE_TYPE = "code";
  // Scopes de Dropbox que quieres solicitar
  const SCOPE = "account_info.read files.content.read files.content.write";
  // El UID se pasa como parámetro para asociar el token al usuario
  const oauthUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=${RESPONSE_TYPE}&token_access_type=offline&state=${
    user?.uid
  }&scope=${encodeURIComponent(SCOPE)}`;

  // Función para borrar el token de Dropbox
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDeleteToken = async () => {
    setIsDeleting(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        dropboxTokens: null,
      });
    } catch (err) {
      console.error("Error deleting Dropbox token:", err);
    }
    setIsDeleting(false);
  };

  return (
    <HStack justifyContent="space-between" w="100%">
      <HStack>
        <Text fontSize={"lg"}>Dropbox Token</Text>
        {data && data.dropboxTokens ? (
          <Tooltip label="Valid Dropbox Token">
            <CheckCircleIcon color="brandTeal.500" />
          </Tooltip>
        ) : (
          <Tooltip label="No válido o no conectado">
            <WarningIcon color="brandOrange.500" />
          </Tooltip>
        )}
      </HStack>
      {data && data.dropboxTokens ? (
        <Button
          colorScheme="red"
          isLoading={isDeleting}
          onClick={handleDeleteToken}
        >
          Desconectar Dropbox
        </Button>
      ) : (
        <Button
          as="a"
          href={oauthUrl}
          colorScheme="brandTeal"
          target="_blank"
          rel="noopener noreferrer"
        >
          Conectar Dropbox
        </Button>
      )}
    </HStack>
  );
}
