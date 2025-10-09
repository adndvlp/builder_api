import AuthCheck from "../../components/AuthCheck";
import { VStack, Heading } from "@chakra-ui/react";
import ChangePassword from "../../components/account/ChangePassword";
import DropboxToken from "../../components/account/DropboxToken";
import GithubToken from "../../components/account/GithubToken";
import DeleteAccount from "../../components/account/DeleteAccount";
import { useState } from "react";

export default function AccountPage({}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <AuthCheck fallbackRoute={deleting ? "/admin/deleted-account" : null}>
      <VStack spacing={8} w="560px">
        <Heading>Account Settings</Heading>
        <ChangePassword />
        <DropboxToken />
        <GithubToken />
        <DeleteAccount setDeleting={setDeleting} />
      </VStack>
    </AuthCheck>
  );
}
