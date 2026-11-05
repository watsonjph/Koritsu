fn main() {
    // Embed the app icon in the Windows executable.
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=assets/icon.ico");
        winresource::WindowsResource::new().set_icon("assets/icon.ico").compile().expect("embed the app icon");
    }
}
